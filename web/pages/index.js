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
  const [pricingPlan, setPricingPlan] = useState("trial");

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
  const testimonials = [
    {
      quote:
        "I stopped wasting nights on job boards. MegaApply pushed my profile to relevant roles and I had two interview calls in the first week.",
      name: "Ahmed K.",
      role: "Electrical Engineer",
      location: "Riyadh, Saudi Arabia"
    },
    {
      quote:
        "The quality of matches is what impressed me most. It only targeted openings that actually fit my EPC background, not random listings.",
      name: "Sara M.",
      role: "Planning Engineer",
      location: "Dubai, UAE"
    },
    {
      quote:
        "I was applying manually for months with almost no response. After switching to MegaApply, my pipeline finally became consistent.",
      name: "Usman R.",
      role: "Mechanical Engineer",
      location: "Lahore, Pakistan"
    },
    {
      quote:
        "For GCC jobs this is a huge time saver. I still customized for final rounds, but auto-apply handled the daily volume perfectly.",
      name: "Priyanka S.",
      role: "Civil Engineer",
      location: "Pune, India"
    }
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
            <h1>
              1-Click Daily Auto Apply to 3,000+{" "}
              <span style={{ color: "var(--accent)" }}>High Paying</span>{" "}
              Engineering Jobs in Saudi 🇸🇦.
            </h1>
            <div className="step-flow" aria-label="How MegaApply works">
              <span className="step-pill">Sign Up</span>
              <span className="step-arrow" aria-hidden="true">&gt;</span>
              <span className="step-pill">Upload CV</span>
              <span className="step-arrow" aria-hidden="true">&gt;</span>
              <span className="step-pill">MegaApply™ Auto Applies for Top Matching Jobs</span>
            </div>
            <div className="hero-actions">
              <button
                className="btn"
                onClick={() => {
                  setMode("signup");
                  authSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Sign up
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  setMode("signin");
                  authSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Sign in
              </button>
            </div>
          </div>
          <div className="hero-art">
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
            <div className="glass-card">
              <div className="glass-title">Categories in Focus</div>
              <div className="pill-grid">
                <span className="pill active">Electrical</span>
                <span className="pill active">HSE</span>
                <span className="pill">Planning</span>
                <span className="pill">Mechanical</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pricing">
        <div className={`pricing-card compact ${pricingPlan === "unlimited" ? "pro" : "free"}`}>
          {pricingPlan === "unlimited" && <div className="pricing-tag">Most popular</div>}
          <div className="pricing-card-header">
            <div className="pricing-topline">
              <span className="pricing-label">PRICING</span>
              <div className="pricing-toggle" role="tablist" aria-label="Pricing switch">
                <button
                  className={`pricing-tab ${pricingPlan === "trial" ? "active" : ""}`}
                  type="button"
                  onClick={() => setPricingPlan("trial")}
                  role="tab"
                  aria-selected={pricingPlan === "trial"}
                >
                  Free Trial
                </button>
                <button
                  className={`pricing-tab ${pricingPlan === "unlimited" ? "active" : ""}`}
                  type="button"
                  onClick={() => setPricingPlan("unlimited")}
                  role="tab"
                  aria-selected={pricingPlan === "unlimited"}
                >
                  Unlimited
                </button>
              </div>
            </div>
          </div>
          <div className="pricing-top">
            <div>
              <p className="notice">
                {pricingPlan === "unlimited"
                  ? "Always‑on auto‑apply with full access"
                  : "Perfect for testing MegaApply™"}
              </p>
            </div>
            <div className="pricing-price">
              <span className="pricing-amount">
                {pricingPlan === "unlimited" ? "$5" : "$0"}
              </span>
              <span className="pricing-cycle">
                {pricingPlan === "unlimited" ? "/month" : "/once"}
              </span>
            </div>
          </div>
          <ul className="pricing-list">
            {pricingPlan === "unlimited" ? (
              <>
                <li>Unlimited applications</li>
                <li>Priority matching engine</li>
                <li>Daily proof‑of‑work digest</li>
                <li>Cancel anytime</li>
              </>
            ) : (
              <>
                <li>50 auto‑applied jobs</li>
                <li>Top‑match targeting</li>
                <li>Daily summary email</li>
                <li>Upgrade anytime</li>
              </>
            )}
          </ul>
          <button
            className={`btn ${pricingPlan === "unlimited" ? "" : "secondary"}`}
            onClick={() => {
              setMode("signup");
              authSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {pricingPlan === "unlimited" ? "Go unlimited" : "Start free"}
          </button>
        </div>
      </section>

      <section className="testimonials">
        <div className="testimonials-head">
          <div className="badge">Customer stories</div>
          <h2>What engineers are saying</h2>
        </div>
        <p className="testimonials-sub">Real hiring momentum from engineers across GCC and South Asia.</p>
        <div className="testimonials-marquee">
          <div className="testimonials-track">
            {[...testimonials, ...testimonials].map((item, idx) => (
              <article className="testimonial-card" key={`${item.name}-${item.location}-${idx}`}>
                <div className="testimonial-stars" aria-hidden="true">★★★★★</div>
                <p className="testimonial-quote">"{item.quote}"</p>
                <div className="testimonial-meta">
                  <div className="testimonial-name">{item.name}</div>
                  <div className="testimonial-role">{item.role}</div>
                  <div className="testimonial-location">{item.location}</div>
                </div>
              </article>
            ))}
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
