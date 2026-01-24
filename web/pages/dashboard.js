import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import {
  ref,
  set,
  get,
  update,
  onValue
} from "firebase/database";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import { getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from "../lib/firebaseClient.js";
import { CATEGORIES } from "../lib/categories.js";

export default function Dashboard() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [db, setDb] = useState(null);
  const [storage, setStorage] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    title: "",
    bio: "",
    photoUrl: "",
    cvUrl: "",
    photoPath: "",
    cvPath: "",
    categories: [],
    autoApplyEnabled: false
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [cvFile, setCvFile] = useState(null);
  const [status, setStatus] = useState("");
  const [jobCounts, setJobCounts] = useState({ total: 0, byCategory: {} });
  const [jobsById, setJobsById] = useState({});
  const [applications, setApplications] = useState([]);

  useEffect(() => {
    const a = getFirebaseAuth();
    const d = getFirebaseDb();
    const s = getFirebaseStorage();
    if (!a || !d || !s) return;
    setAuth(a);
    setDb(d);
    setStorage(s);
    return onAuthStateChanged(a, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/");
        return;
      }
      const snap = await get(ref(d, `users/${u.uid}`));
      if (snap.exists()) {
        setProfile({
          ...profile,
          ...snap.val(),
          email: u.email || snap.val().email || ""
        });
      } else {
        setProfile((p) => ({ ...p, email: u.email || "" }));
      }
    });
  }, []);

  useEffect(() => {
    if (!db) return;
    const jobsRef = ref(db, "jobs");
    const unsub = onValue(jobsRef, (snap) => {
      if (!snap.exists()) {
        setJobCounts({ total: 0, byCategory: {} });
        setJobsById({});
        return;
      }
      const byCategory = {};
      let total = 0;
      const map = {};
      snap.forEach((child) => {
        const job = child.val() || {};
        const cat = job.category || "Uncategorized";
        byCategory[cat] = (byCategory[cat] || 0) + 1;
        total += 1;
        map[child.key] = { id: child.key, ...job };
      });
      setJobCounts({ total, byCategory });
      setJobsById(map);
    });
    return () => unsub();
  }, [db]);

  useEffect(() => {
    if (!db || !user) return;
    const appsRef = ref(db, `applications/${user.uid}`);
    const unsub = onValue(appsRef, (snap) => {
      if (!snap.exists()) {
        setApplications([]);
        return;
      }
      const items = [];
      snap.forEach((child) => {
        const v = child.val() || {};
        items.push({ jobId: child.key, appliedAt: v.appliedAt || 0 });
      });
      items.sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
      setApplications(items);
    });
    return () => unsub();
  }, [db, user]);

  const categoryOptions = useMemo(() => CATEGORIES, []);

  function toggleCategory(cat) {
    setProfile((p) => {
      const has = p.categories.includes(cat);
      const next = has ? p.categories.filter((c) => c !== cat) : [...p.categories, cat];
      if (next.length > 2) return p;
      return { ...p, categories: next };
    });
  }

  async function uploadAsset(file, path) {
    if (!file || !user || !storage) return "";
    const sref = storageRef(storage, path);
    await uploadBytes(sref, file);
    const url = await getDownloadURL(sref);
    return { url, path };
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!user || !db) return;
    setStatus("Saving...");
    try {
      let photoUrl = profile.photoUrl;
      let cvUrl = profile.cvUrl;
      let photoPath = profile.photoPath;
      let cvPath = profile.cvPath;
      if (photoFile) {
        const out = await uploadAsset(photoFile, `users/${user.uid}/profile.jpg`);
        photoUrl = out.url;
        photoPath = out.path;
      }
      if (cvFile) {
        const out = await uploadAsset(cvFile, `users/${user.uid}/cv.pdf`);
        cvUrl = out.url;
        cvPath = out.path;
      }
      const payload = {
        ...profile,
        email: user.email,
        photoUrl,
        cvUrl,
        photoPath,
        cvPath
      };
      await set(ref(db, `users/${user.uid}`), payload);
      setProfile(payload);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err.message || "Save failed");
    }
  }

  async function startAutoApply() {
    if (!user || !db) return;
    if (profile.categories.length === 0) {
      setStatus("Please select up to two categories.");
      return;
    }
    setStatus("Auto apply enabled.");
    await update(ref(db, `users/${user.uid}`), {
      categories: profile.categories,
      autoApplyEnabled: true,
      lastAutoApply: 0
    });
    const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || "";
    if (base) {
      try {
        await fetch(`${base}/runAutoApplyNow?userId=${user.uid}`);
      } catch {}
    }
  }

  if (!user) {
    return (
      <div className="container">
        <div className="card">Please sign in first.</div>
      </div>
    );
  }

  const selectedCount = profile.categories.reduce(
    (sum, cat) => sum + (jobCounts.byCategory[cat] || 0),
    0
  );

  return (
    <div className="container">
      <div className="header">
        <div className="brand">MegaApply<span>™</span> Dashboard</div>
        <div className="actions">
          <a className="tag" href="/">Home</a>
          {auth && <button className="btn secondary" onClick={() => signOut(auth)}>Sign out</button>}
        </div>
      </div>

      <div className="split">
        <div className="card hero">
          <h2>Select up to 2 categories</h2>
          <p className="notice">Choose your focus areas. We auto‑apply to every new job in your picks.</p>
          <div className="stats">
            <div className="stat">
              <div className="label">Total jobs in database</div>
              <div className="value">{jobCounts.total}</div>
            </div>
            <div className="stat">
              <div className="label">Jobs in selected categories</div>
              <div className="value">{selectedCount}</div>
            </div>
          </div>
          <div className="actions" style={{ marginTop: 18, flexWrap: "wrap" }}>
            {categoryOptions.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`pill ${profile.categories.includes(cat) ? "active" : ""}`}
                onClick={() => toggleCategory(cat)}
                title={`${jobCounts.byCategory[cat] || 0} jobs`}
              >
                {cat} · {jobCounts.byCategory[cat] || 0}
              </button>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 20 }}>
            <button className="btn" onClick={startAutoApply}>Start Auto Apply</button>
            <span className="tag">{profile.autoApplyEnabled ? "Auto apply is ON" : "Auto apply is OFF"}</span>
          </div>
          <p className="notice">We will email employers your profile + CV and send you daily summaries.</p>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 6 }}>Auto applied jobs</h3>
            <p className="notice">Total applications: {applications.length}</p>
            <div className="scroll">
              {applications.length === 0 && (
                <div className="notice">No applications yet.</div>
              )}
              {applications.map((app) => {
                const job = jobsById[app.jobId] || {};
                const title = job.title || "Job";
                const date = app.appliedAt
                  ? new Date(app.appliedAt).toLocaleDateString()
                  : "—";
                return (
                  <div className="job-row" key={app.jobId}>
                    <div className="job-title">{title}</div>
                    <div className="job-date">{date}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Your profile</h2>
          <form onSubmit={saveProfile}>
            <div className="grid">
              <div className="col-6">
                <label className="label">Full Name</label>
                <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
              </div>
              <div className="col-6">
                <label className="label">Email</label>
                <input className="input" value={profile.email} disabled />
              </div>
              <div className="col-6">
                <label className="label">Job Title</label>
                <input className="input" value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} />
              </div>
              <div className="col-6">
                <label className="label">Professional Photo</label>
                <input className="input" type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              </div>
              <div className="col-12">
                <label className="label">About you</label>
                <textarea className="textarea" value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
              </div>
              <div className="col-12">
                <label className="label">CV (PDF)</label>
                <input className="input" type="file" accept="application/pdf" onChange={(e) => setCvFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="actions" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">Save Profile</button>
              {status && <span className="tag">{status}</span>}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
