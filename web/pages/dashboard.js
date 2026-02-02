import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
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
import { trackEvent } from "../lib/analytics.js";

export default function Dashboard() {
  const FUNCTIONS_BASE_URL =
    process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ||
    "https://us-central1-mega-apply.cloudfunctions.net";
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
  const [exploreJobs, setExploreJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [isSyncingApps, setIsSyncingApps] = useState(false);
  const [lastRunAppliedCount, setLastRunAppliedCount] = useState(null);
  const [matchStats, setMatchStats] = useState(null);
  const [isComputingMatches, setIsComputingMatches] = useState(false);
  const [isMatchStatsLoading, setIsMatchStatsLoading] = useState(false);
  const [hasSavedProfile, setHasSavedProfile] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoApplying, setIsAutoApplying] = useState(false);
  const [exploreCategory, setExploreCategory] = useState("");
  const [activeJob, setActiveJob] = useState(null);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [missingProfileFields, setMissingProfileFields] = useState([]);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const FREE_APPLY_LIMIT = 50;

  function formatDescriptionSnippet(text, maxLen = 110) {
    if (!text) return "";
    const cleaned = String(text).replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    if (cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, maxLen - 1)}…`;
  }

  useEffect(() => {
    if (hasSavedProfile && !matchStats) {
      setIsMatchStatsLoading(true);
    } else {
      setIsMatchStatsLoading(false);
    }
  }, [hasSavedProfile, matchStats]);

  function parseApplicationsSnapshot(snap) {
    if (!snap.exists()) return [];
    const items = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      items.push({ jobId: child.key, appliedAt: v.appliedAt || 0 });
    });
    items.sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
    return items;
  }

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
      setIsProfileLoading(true);
      const snap = await get(ref(d, `users/${u.uid}`));
      if (snap.exists()) {
        setHasSavedProfile(true);
        setIsEditing(false);
        const saved = snap.val() || {};
        setMatchStats(saved.matchStats || null);
        setProfile({
          ...profile,
          ...saved,
          email: u.email || saved.email || ""
        });
      } else {
        setHasSavedProfile(false);
        setIsEditing(true);
        setProfile((p) => ({ ...p, email: u.email || "" }));
        setMatchStats(null);
      }
      setIsProfileLoading(false);
    });
  }, []);

  useEffect(() => {
    trackEvent("page_view", { page: "dashboard" });
  }, []);

  useEffect(() => {
    if (!matchStats?.totalJobs) return;
    setJobCounts((prev) => ({ ...prev, total: matchStats.totalJobs }));
  }, [matchStats]);

  useEffect(() => {
    if (!db || !user) return;
    const appsRef = ref(db, `applications/${user.uid}`);
    const unsub = onValue(appsRef, (snap) => {
      setApplications(parseApplicationsSnapshot(snap));
    });
    return () => unsub();
  }, [db, user]);

  const categoryOptions = useMemo(() => CATEGORIES, []);

  useEffect(() => {
    if (!applications.length) {
      setJobsById({});
      return;
    }
    const ids = applications.map((a) => a.jobId).slice(0, 200);
    const load = async () => {
      try {
        const res = await fetch(
          `${FUNCTIONS_BASE_URL}/getJobsByIds?ids=${encodeURIComponent(ids.join(","))}`
        );
        const data = await res.json();
        setJobsById(data.jobs || {});
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, [applications, FUNCTIONS_BASE_URL]);

  useEffect(() => {
    if (!exploreCategory) {
      setExploreJobs([]);
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(
          `${FUNCTIONS_BASE_URL}/listJobs?category=${encodeURIComponent(exploreCategory)}&limit=60`
        );
        const data = await res.json();
        setExploreJobs(Array.isArray(data.jobs) ? data.jobs : []);
      } catch (err) {
        console.error(err);
        setExploreJobs([]);
      }
    };
    load();
  }, [exploreCategory, FUNCTIONS_BASE_URL]);

  useEffect(() => {
    if (!activeJob) return;
    const handleKey = (event) => {
      if (event.key === "Escape") {
        setActiveJob(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeJob]);

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
    setIsSaving(true);
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
      setHasSavedProfile(true);
      setIsEditing(false);
      setPhotoFile(null);
      setCvFile(null);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err.message || "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function startAutoApply() {
    if (!user || !db) return;
    const missing = [];
    if (!profile.name) missing.push("Full name");
    if (!profile.title) missing.push("Job title");
    if (!profile.bio) missing.push("Summary");
    if (!profile.cvUrl && !profile.cvPath) missing.push("CV");
    if (missing.length > 0) {
      setMissingProfileFields(missing);
      setShowProfilePrompt(true);
      setStatus("Complete your profile to start auto apply.");
      return;
    }
    if (!isSubscribed && applications.length >= FREE_APPLY_LIMIT) {
      setShowSubscribeModal(true);
      setStatus("Free limit reached. Subscribe to continue auto applying.");
      return;
    }
    setIsAutoApplying(true);
    setIsSyncingApps(true);
    setLastRunAppliedCount(null);
    setStatus("Auto apply enabled.");
    try {
      trackEvent("auto_apply_enabled", { mode: "profile_match" });
      await update(ref(db, `users/${user.uid}`), {
        autoApplyEnabled: true,
        lastAutoApply: 0
      });
      const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || "";
      if (base) {
        try {
          const resp = await fetch(`${base}/runAutoApplyNow?userId=${user.uid}`);
          if (resp.ok) {
            const json = await resp.json();
            if (typeof json.applied === "number") {
              setLastRunAppliedCount(json.applied);
            }
            if (json?.blocked) {
              setShowSubscribeModal(true);
            }
          }
          const snap = await get(ref(db, `applications/${user.uid}`));
          setApplications(parseApplicationsSnapshot(snap));
        } catch {}
      }
    } finally {
      setIsSyncingApps(false);
      setIsAutoApplying(false);
    }
  }

  async function computeMatches() {
    if (!user || !db) return;
    setIsComputingMatches(true);
    setIsMatchStatsLoading(true);
    setStatus("Calculating match stats...");
    try {
      const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || "";
      if (base) {
        const resp = await fetch(`${base}/computeMatchStatsNow?userId=${user.uid}`);
        if (resp.ok) {
          const data = await resp.json();
          setMatchStats(data);
        }
      }
      const snap = await get(ref(db, `users/${user.uid}`));
      if (snap.exists()) {
        setMatchStats(snap.val().matchStats || null);
      }
    } finally {
      setIsComputingMatches(false);
      setIsMatchStatsLoading(false);
      setStatus("");
    }
  }

  async function pauseAutoApply() {
    if (!user || !db) return;
    setIsAutoApplying(true);
    setStatus("Auto apply paused.");
    try {
      await update(ref(db, `users/${user.uid}`), {
        autoApplyEnabled: false
      });
    } finally {
      setIsAutoApplying(false);
    }
  }

  async function startSubscriptionCheckout() {
    if (!user) return;
    setIsSubscribing(true);
    setStatus("Redirecting to Stripe...");
    try {
      const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || "";
      const resp = await fetch(`${base}/createCheckoutSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid })
      });
      const data = await resp.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setStatus("Unable to start subscription.");
    } catch (err) {
      setStatus(err?.message || "Unable to start subscription.");
    } finally {
      setIsSubscribing(false);
    }
  }

  async function openBillingPortal() {
    if (!user) return;
    setIsSubscribing(true);
    setStatus("Opening billing portal...");
    try {
      const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || "";
      const resp = await fetch(`${base}/createBillingPortalSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid })
      });
      const data = await resp.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setStatus("Unable to open billing portal.");
    } catch (err) {
      setStatus(err?.message || "Unable to open billing portal.");
    } finally {
      setIsSubscribing(false);
    }
  }

  const exploreJobsView = useMemo(() => exploreJobs, [exploreJobs]);
  const applicationsToday = useMemo(() => {
    if (!applications.length) return 0;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return applications.filter((app) => (app.appliedAt || 0) >= startMs).length;
  }, [applications]);
  const subscriptionStatus = profile?.subscription?.status || "";
  const isSubscribed = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const freeRemaining = Math.max(0, FREE_APPLY_LIMIT - applications.length);

  useEffect(() => {
    if (!isSubscribed && applications.length >= FREE_APPLY_LIMIT) {
      setShowSubscribeModal(true);
    }
  }, [applications.length, isSubscribed]);

  function formatTitleDisplay(title) {
    if (!title) return "";
    return title
      .replace(/\bqa\/?qc\b/gi, "QA/QC")
      .replace(/\bqaqc\b/gi, "QA/QC")
      .replace(/\bqa\b/gi, "QA")
      .replace(/\bqc\b/gi, "QC")
      .replace(/\bqs\b/gi, "QS");
  }

  if (!user) {
    return (
      <div className="container">
        <div className="card">Please sign in first.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <Head>
        <title>MegaApply™ Dashboard</title>
      </Head>
      <div className="header">
        <div className="logo" aria-label="MegaApply">
          <div className="logo-holo" aria-hidden="true" />
          <div className="logo-text">
            <div className="name">MegaApply<span>™</span></div>
            <div className="tagline">Auto Apply Engine</div>
          </div>
        </div>
        <div className="actions">
          {auth && <button className="btn secondary" onClick={() => signOut(auth)}>Sign out</button>}
        </div>
      </div>

      <section className="dash-hero">
        <div className="dash-orb one" />
        <div className="dash-orb two" />
        <div className="dash-orb three" />
        <div className="dash-hero-content">
          <p className="dash-kicker">
            TARGET HIGHER‑PAYING <span>ENGINEERING</span> ROLES FASTER
          </p>
          <h1>Bulk Apply to 3,000+ Jobs in Saudi Arabia 🇸🇦</h1>
          <div className="dash-tags">
            <span className="tag">Daily Auto‑Apply</span>
            <span className="tag">Proof of Work Emails</span>
          </div>
          <p className="notice auto-callout" style={{ marginTop: 12 }}>
            Passively auto apply to 100s of jobs daily while you focus on interviews.
          </p>
        </div>
      </section>

      <div className="split">
        <div className="card hero">
          <h2>Profile matching</h2>
          <p className="notice">
            We match jobs to your title and summary, then auto‑apply only to good fits.
          </p>
          <div className="stats">
            <div className="stat">
              <div className="label">Total jobs in database</div>
              <div className="value">{jobCounts.total}</div>
            </div>
            <div className="stat">
              <div className="label">Jobs matching your profile</div>
              <div className="value">{matchStats?.matchingJobs ?? "—"}</div>
            </div>
          </div>
          {(isMatchStatsLoading || isComputingMatches) && (
            <div style={{ marginTop: 12 }}>
              <div className="loading-bar compact" aria-hidden="true">
                <span />
              </div>
              <p className="notice" style={{ marginTop: 6 }}>
                Matching jobs is loading. Please wait…
              </p>
            </div>
          )}
          <p className="notice" style={{ marginTop: 12 }}>
            {matchStats?.updatedAt
              ? `Match stats updated ${new Date(matchStats.updatedAt).toLocaleString()}`
              : "Run auto apply to calculate your match stats."}
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className={`btn ghost pressable ${isComputingMatches ? "loading" : ""}`}
              onClick={computeMatches}
              disabled={isComputingMatches}
            >
              {isComputingMatches ? "Calculating..." : "Compute matches"}
            </button>
          </div>
          <div className="actions" style={{ marginTop: 20 }}>
            <button
              className={`btn pressable ${isAutoApplying ? "loading" : ""}`}
              onClick={startAutoApply}
              disabled={isAutoApplying || (!isSubscribed && freeRemaining <= 0)}
              title={
                !isSubscribed && freeRemaining <= 0
                  ? "Subscribe to keep auto applying"
                  : ""
              }
            >
              {isAutoApplying ? "Starting..." : "Start Auto Apply"}
            </button>
            <button
              className="btn ghost pressable"
              type="button"
              onClick={pauseAutoApply}
              disabled={isAutoApplying || !profile.autoApplyEnabled}
              title={profile.autoApplyEnabled ? "Pause daily emails" : "Auto apply is already paused"}
            >
              Pause
            </button>
            <span className="tag">{profile.autoApplyEnabled ? "Auto apply is ON" : "Auto apply is OFF"}</span>
            {isSubscribed && (
              <button
                className="btn ghost pressable"
                type="button"
                onClick={openBillingPortal}
                disabled={isSubscribing}
              >
                Manage billing
              </button>
            )}
          </div>
          {isAutoApplying && (
            <div className="loading-bar compact" aria-hidden="true">
              <span />
            </div>
          )}
          <p className="notice">We will email employers your profile + CV and send you daily summaries.</p>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 6 }}>Auto applied jobs</h3>
            <p className="notice">
              Total applications: {applications.length} · Sent today: {applicationsToday}
              {typeof lastRunAppliedCount === "number" ? ` · Last run: ${lastRunAppliedCount}` : ""}
              {isSyncingApps ? " · Syncing…" : ""}
              {isSubscribed
                ? " · Plan: Unlimited"
                : ` · Free applies left: ${freeRemaining}`}
            </p>
            <div className="scroll">
              {applications.length === 0 && (
                <div className="notice">No applications yet.</div>
              )}
              {applications.map((app) => {
                const job = jobsById[app.jobId] || {};
                const title = job.title || "Job";
                const description = job.description || "";
                const snippet = formatDescriptionSnippet(description);
                const date = app.appliedAt
                  ? new Date(app.appliedAt).toLocaleDateString()
                  : "—";
                return (
                  <div className="job-row" key={app.jobId}>
                    <div className="job-title">
                      <button
                        className="job-title-button"
                        type="button"
                        onClick={() => setActiveJob({ title, description })}
                        aria-label={`Open details for ${title}`}
                      >
                        {title}
                      </button>
                      {snippet ? <span className="job-snippet"> - {snippet}</span> : null}
                    </div>
                    <div className="job-date">{date}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {activeJob && (
            <div
              className="job-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`Job details for ${activeJob.title}`}
              onClick={() => setActiveJob(null)}
            >
              <div className="job-modal" onClick={(event) => event.stopPropagation()}>
                <div className="job-modal-header">
                  <div className="job-modal-title">{activeJob.title}</div>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setActiveJob(null)}
                  >
                    Close
                  </button>
                </div>
                <div className="job-modal-body">
                  {activeJob.description ? activeJob.description : "No description available."}
                </div>
              </div>
            </div>
          )}

          {showProfilePrompt && (
            <div
              className="job-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Complete your profile to enable auto apply"
              onClick={() => setShowProfilePrompt(false)}
            >
              <div className="job-modal profile-gate" onClick={(event) => event.stopPropagation()}>
                <div className="job-modal-header">
                  <div className="job-modal-title">Quick pit stop ⛽</div>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setShowProfilePrompt(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="job-modal-body">
                  <div className="profile-gate-copy">
                    We’re ready to auto‑apply, but we need your profile tuned first.
                    {profile.title
                      ? ` That ${profile.title} skillset deserves the best matches.`
                      : " Your skills deserve the best matches."}
                  </div>
                  {missingProfileFields.length > 0 && (
                    <div className="profile-gate-missing">
                      Missing: {missingProfileFields.join(", ")}
                    </div>
                  )}
                  <div className="profile-gate-actions">
                    <button
                      className="btn pressable"
                      type="button"
                      onClick={() => {
                        setShowProfilePrompt(false);
                        setIsEditing(true);
                      }}
                    >
                      Complete profile
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setShowProfilePrompt(false)}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showSubscribeModal && !isSubscribed && (
            <div
              className="job-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Subscribe to continue auto apply"
              onClick={() => setShowSubscribeModal(false)}
            >
              <div className="job-modal billing-modal" onClick={(event) => event.stopPropagation()}>
                <div className="job-modal-header">
                  <div className="job-modal-title">You’ve hit the free limit</div>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setShowSubscribeModal(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="job-modal-body">
                  <p className="billing-copy">
                    You can auto‑apply to 50 jobs for free. Subscribe for $5/month to unlock
                    unlimited applications and keep daily auto‑apply running.
                  </p>
                  <div className="billing-meta">
                    Free applies used: {applications.length} / {FREE_APPLY_LIMIT}
                  </div>
                  <div className="profile-gate-actions">
                    <button
                      className={`btn pressable ${isSubscribing ? "loading" : ""}`}
                      type="button"
                      onClick={startSubscriptionCheckout}
                      disabled={isSubscribing}
                    >
                      {isSubscribing ? "Redirecting..." : "Subscribe $5/month"}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setShowSubscribeModal(false)}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        <div className="stack">
          <div className="card">
            <div className="profile-header">
              <h2>Your profile</h2>
              {hasSavedProfile && !isEditing && (
                <button className="btn ghost" type="button" onClick={() => setIsEditing(true)}>
                  Edit Profile
                </button>
              )}
            </div>
            {(isProfileLoading || isSaving) && (
              <div className="loading-bar">
                <span />
              </div>
            )}

            {!isEditing && hasSavedProfile ? (
              <div className="profile-view">
                <div className="profile-hero">
                  <div className="avatar">
                    {profile.photoUrl ? (
                      <img src={profile.photoUrl} alt="Profile photo" />
                    ) : (
                      <div className="avatar-fallback">{(profile.name || "U").slice(0, 1).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="profile-meta">
                    <div className="profile-name">{profile.name || "Your name"}</div>
                    <div className="profile-title">{profile.title || "Your job title"}</div>
                    <div className="profile-email">{profile.email}</div>
                  </div>
                </div>
                <div className="profile-body">
                  <div>
                    <div className="label">About you</div>
                    <p className="profile-text">{profile.bio || "Add a short professional summary so employers understand your strengths."}</p>
                  </div>
                  <div className="profile-files">
                    <div className="file-card">
                      <span>CV</span>
                      {profile.cvUrl ? (
                        <a className="link" href={profile.cvUrl} target="_blank" rel="noreferrer">View PDF</a>
                      ) : (
                        <span className="notice">Not uploaded</span>
                      )}
                    </div>
                    <div className="file-card">
                      <span>Photo</span>
                      {profile.photoUrl ? (
                        <a className="link" href={profile.photoUrl} target="_blank" rel="noreferrer">Open</a>
                      ) : (
                        <span className="notice">Not uploaded</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
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
                  {hasSavedProfile && (
                    <button className="btn ghost" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                  )}
                  {status && <span className="tag">{status}</span>}
                </div>
              </form>
            )}

          </div>

          <div className="card">
            <h3 style={{ marginBottom: 6 }}>Explore jobs</h3>
            <p className="notice">Pick a category to browse titles.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <select
                className="select"
                value={exploreCategory}
                onChange={(e) => setExploreCategory(e.target.value)}
              >
                <option value="">Select category</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="scroll" style={{ marginTop: 12 }}>
              {!exploreCategory && <div className="notice">Choose a category to see jobs.</div>}
              {exploreCategory && exploreJobsView.length === 0 && (
                <div className="notice">No jobs found for this category.</div>
              )}
            {exploreJobsView.map((job) => (
              <div className="job-row" key={job.id}>
                <div className="job-title">{formatTitleDisplay(job.title)}</div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
