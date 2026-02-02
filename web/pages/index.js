import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { getFirebaseAuth } from "../lib/firebaseClient.js";
import { trackEvent } from "../lib/analytics.js";

export default function Home() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const authSectionRef = useRef(null);
  const [demoFeed, setDemoFeed] = useState([]);
  const [demoHold, setDemoHold] = useState(false);
  const demoIndexRef = useRef(0);

  const demoJobs = [
    { title: "Senior Electrical Engineer", company: "Gulf Energy", location: "Riyadh", category: "Electrical" },
    { title: "HSE Site Supervisor", company: "Najd Builders", location: "Dammam", category: "HSE" },
    { title: "Project Controls Lead", company: "Red Sands PMO", location: "NEOM", category: "Project Management" },
    { title: "Civil QA/QC Inspector", company: "Atlas Civil", location: "Jeddah", category: "QAQC" },
    { title: "Planning Engineer", company: "Desert Rail", location: "Tabuk", category: "Planning" },
    { title: "Mechanical Supervisor", company: "Harbor Works", location: "Yanbu", category: "Mechanical" },
    { title: "Procurement Coordinator", company: "Sahar Logistics", location: "Riyadh", category: "Procurement" },
    { title: "Quantity Surveyor", company: "Eastern Infra", location: "Khobar", category: "Estimation" }
  ];

  useEffect(() => {
    const a = getFirebaseAuth();
    if (!a) return;
    setAuth(a);
    return onAuthStateChanged(a, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (user) router.push("/dashboard");
  }, [user, router]);

  useEffect(() => {
    trackEvent("page_view", { page: "home" });
  }, []);

  useEffect(() => {
    const tick = () => {
      const index = demoIndexRef.current;
      demoIndexRef.current += 1;
      setDemoFeed((prev) => {
        const job = demoJobs[index % demoJobs.length];
        const item = {
          id: `${Date.now()}-${index}`,
          ...job
        };
        return [item, ...prev].slice(0, 6);
      });
    };
    tick();
    const interval = setInterval(tick, demoHold ? 4200 : 1500);
    return () => clearInterval(interval);
  }, [demoHold]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!auth) return;
    setAuthLoading(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message || "Auth failed");
    } finally {
      setAuthLoading(false);
    }
  }

  return (
    <div className="container">
      <Head>
        <title>MegaApply™ — Auto Apply Engine</title>
      </Head>
        <div className="header">
          <div className="logo" aria-label="MegaApply">
            <div className="logo-holo" aria-hidden="true" />
            <div className="logo-text">
              <div className="name">MegaApply<span>™</span></div>
              <div className="tagline">Auto Apply Engine</div>
            </div>
          </div>
        {user && auth && (
          <div className="actions">
            <a className="tag" href="/dashboard">Go to Dashboard</a>
            <button className="btn secondary" onClick={() => signOut(auth)}>Sign out</button>
          </div>
        )}
      </div>

      <section className="hero">
        <div className="orb one" />
        <div className="orb two" />
        <div className="orb three" />
        <div className="hero-grid">
          <div className="hero-copy">
            <h2>Target higher‑paying <span style={{ color: "var(--accent)" }}>engineering</span> roles faster</h2>
            <h1>Bulk Apply to 3,000+ Jobs in Saudi Arabia 🇸🇦</h1>
            <p>
              MegaApply™ matches you only to roles where you’re a top fit, cleans listings,
              and auto-applies in the background while you interview.
            </p>
            <div className="hero-actions">
              <button
                className="btn"
                onClick={() => {
                  setMode("signup");
                  authSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Start Auto Apply
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  setMode("signin");
                  authSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                I already have an account
              </button>
            </div>
            <div className="hero-tags">
              <span className="tag">AI‑Cleaned Listings</span>
              <span className="tag">Top‑Match Targeting</span>
              <span className="tag">Always‑On Auto‑Apply</span>
            </div>
            <p className="notice auto-callout" style={{ marginTop: 12 }}>
              Stay focused on interviews while MegaApply™ targets your best‑fit roles.
            </p>
          </div>
          <div className="hero-art">
            <div className="glass-card">
              <div className="glass-title">Categories in Focus</div>
              <div className="pill-grid">
                <span className="pill active">Electrical</span>
                <span className="pill active">HSE</span>
                <span className="pill">Planning</span>
                <span className="pill">Mechanical</span>
              </div>
            </div>
            <div
              className="glass-card auto-apply-demo"
              onMouseEnter={() => setDemoHold(true)}
              onMouseLeave={() => setDemoHold(false)}
            >
              <div className="glass-title">Auto-Apply in Action</div>
              <p className="notice demo-status">
                Applying now<span className="demo-dots" aria-hidden="true">...</span>
              </p>
              <div className="demo-scroll" role="list">
                {demoFeed.map((job) => (
                  <div className="demo-row" key={job.id} role="listitem">
                    <div className="demo-title">{job.title}</div>
                    <div className="demo-meta">
                      {job.company} · {job.location} · {job.category}
                    </div>
                    <span className="demo-tag">Applied</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid stretch" style={{ marginTop: 24 }} ref={authSectionRef}>
        <div className="col-6">
          <div className="card hero full-height">
            <div className="badge">Create your account</div>
            <h2 className="hero-title">{mode === "signup" ? "Start your MegaApply™ profile" : "Welcome back"}</h2>
            <p className="hero-sub">
              Tell us about your role, upload your CV, and MegaApply™ handles the rest.
            </p>
            <form onSubmit={handleSubmit}>
              <label className="label">Email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {authLoading && (
                <div className="loading-bar">
                  <span />
                </div>
              )}
              {error && <p className="notice">{error}</p>}
              <div className="actions" style={{ marginTop: 16 }}>
                <button className="btn" type="submit" disabled={authLoading}>
                  {mode === "signup" ? "Sign up" : "Sign in"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
                  disabled={authLoading}
                >
                  {mode === "signup" ? "Have an account?" : "Create account"}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="col-6">
          <div className="card full-height">
            <h2>What MegaApply™ does for you</h2>
            <div className="infographics">
              <div className="info-card">
                <span className="info-badge green">Auto‑Apply</span>
                <h4>Applies for new matches</h4>
                <p>We email employers your profile and CV automatically.</p>
              </div>
              <div className="info-card">
                <span className="info-badge blue">Daily Digest</span>
                <h4>Proof of work</h4>
                <p>See every job applied to, grouped by category.</p>
              </div>
              <div className="info-card">
                <span className="info-badge yellow">Smart Match</span>
                <h4>Profile precision</h4>
                <p>Only jobs that match your profile are auto‑applied.</p>
              </div>
              <div className="info-card">
                <span className="info-badge pink">Hands‑Free</span>
                <h4>Always‑on pipeline</h4>
                <p>No manual re‑checking job boards every day.</p>
              </div>
              <div className="info-card">
                <span className="info-badge green">Employer‑Ready</span>
                <h4>Professional emails</h4>
                <p>Beautiful, centered emails that stand out.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 28, textAlign: "center" }}>
        Powered by So Jobless Inc.
      </div>
    </div>
  );
}
