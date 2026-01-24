import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { getFirebaseAuth } from "../lib/firebaseClient.js";

export default function Home() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const a = getFirebaseAuth();
    if (!a) return;
    setAuth(a);
    return onAuthStateChanged(a, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (user) router.push("/dashboard");
  }, [user, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!auth) return;
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message || "Auth failed");
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">MegaApply<span>™</span></div>
        {user && auth && (
          <div className="actions">
            <a className="tag" href="/dashboard">Go to Dashboard</a>
            <button className="btn secondary" onClick={() => signOut(auth)}>Sign out</button>
          </div>
        )}
      </div>

      <div className="grid">
        <div className="col-6">
          <div className="card">
            <h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
            <p className="notice">
              Sign up or sign in to start auto‑applying to fresh Saudi job listings.
            </p>
            <form onSubmit={handleSubmit}>
              <label className="label">Email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="notice">{error}</p>}
              <div className="actions" style={{ marginTop: 16 }}>
                <button className="btn" type="submit">
                  {mode === "signup" ? "Sign up" : "Sign in"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
                >
                  {mode === "signup" ? "Have an account?" : "Create account"}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="col-6">
          <div className="card">
            <h2>Auto Apply, daily.</h2>
            <p>
              Select up to two categories. We auto‑apply to every new job and send a
              beautiful summary email. You focus on interviews.
            </p>
            <ul>
              <li>AI‑cleaned job posts.</li>
              <li>Profile + CV emailed to employers.</li>
              <li>Daily MegaApply™ digest.</li>
            </ul>
            <div className="notice">Powered by So Jobless Inc.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
