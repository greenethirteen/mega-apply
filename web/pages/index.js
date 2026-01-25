import { useEffect, useRef, useState } from "react";
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
            <h1>Bulk Apply to 1,000+ Jobs in Saudi Arabia 🇸🇦</h1>
            <p>
              We’ll email every matching job & keep applying daily. MegaApply™
              cleans listings, sends applications, and gives you a daily summary.
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
              <span className="tag">Daily Auto‑Apply</span>
              <span className="tag">Email Summary</span>
            </div>
          </div>
          <div className="hero-art">
            <div className="glass-card">
              <div className="glass-title">Match Coverage</div>
              <div className="mini-bar"><span /></div>
              <p className="notice" style={{ marginTop: 10 }}>Applied to 128 new roles this week</p>
            </div>
            <div className="glass-card">
              <div className="glass-title">Categories in Focus</div>
              <div className="pill-grid">
                <span className="pill active">Electrical</span>
                <span className="pill active">HSE</span>
                <span className="pill">Planning</span>
                <span className="pill">Mechanical</span>
              </div>
            </div>
            <div className="glass-card">
              <div className="glass-title">Daily Summary Email</div>
              <p className="notice">Total: 26 · HSE: 10 · Electrical: 16</p>
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
                <h4>Category precision</h4>
                <p>Only your top 2 categories are auto‑applied.</p>
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
