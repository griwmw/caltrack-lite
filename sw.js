const CACHE = "caltrack-lite-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// === Firebase init ===
// 1) replace with your config from Firebase console
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();

// per-user doc path helpers
const userDoc = (uid) => db.collection("users").doc(uid);
const dataDoc = (uid) => userDoc(uid).collection("data").doc("current"); // single doc with all app data

// UI refs
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const userEmailLbl = document.getElementById("userEmail");

// Sign in/out
signInBtn.addEventListener("click", async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  // On iOS Safari, redirect works best:
  await auth.signInWithRedirect(provider);
});
signOutBtn.addEventListener("click", async () => { await auth.signOut(); });

// Auth state listener — runs on every app load and when user logs in/out
let currentUid = null;
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUid = user.uid;
    signInBtn.style.display = "none";
    signOutBtn.style.display = "inline-block";
    userEmailLbl.textContent = user.email || "";

    // Load cloud data and merge
    await loadFromCloud(currentUid);
    // Render after cloud load to reflect latest
    renderAll(); renderCalendar(); renderDayPane(todayKey);
  } else {
    currentUid = null;
    signInBtn.style.display = "inline-block";
    signOutBtn.style.display = "none";
    userEmailLbl.textContent = "";
    // stay usable offline with local data
  }
});

// Load user data from Firestore (merge into local)
async function loadFromCloud(uid) {
  try {
    const snap = await dataDoc(uid).get();
    if (snap.exists) {
      const data = snap.data() || {};
      // merge (cloud wins if both present)
      profile = data.profile || profile;
      goal    = data.goal    || goal;
      logs    = data.logs    || logs;
      weights = data.weights || weights;
      // persist locally too
      save(LS.profile, profile); save(LS.goal, goal);
      save(LS.logs, logs);       save(LS.weights, weights);
      saveToCloudDebounced();

      // push into visible inputs if needed
      $("#sex").value = profile.sex; $("#age").value = profile.age;
      $("#height").value = profile.heightCm; $("#weight").value = profile.weightKg;
      $("#activity").value = profile.activity;
      $("#startW").value = goal.startWeightKg; $("#targetW").value = goal.targetWeightKg;
    }
  } catch (e) {
    console.error("loadFromCloud failed", e);
  }
}

// Debounced cloud save any time data changes
let saveTimer = null;
function saveToCloudDebounced() {
  if (!currentUid) return; // not signed in
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloudNow, 1000); // 1s debounce
}

async function saveToCloudNow() {
  if (!currentUid) return;
  try {
    const payload = { profile, goal, logs, weights, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    await dataDoc(currentUid).set(payload, { merge: true });
    // success; nothing else to do
  } catch (e) {
    console.error("saveToCloudNow failed", e);
  }
}


self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(res => res || fetch(e.request).then(r=>{
        const copy = r.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
        return r;
      }).catch(()=>caches.match("./index.html")))
    );
  }
});

