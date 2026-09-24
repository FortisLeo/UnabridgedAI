import { useState } from "react";
import { api } from "../../lib/api.ts";
import type { Quota, Settings, User } from "../../types.ts";

export function AuthScreen({
  mode,
  setMode,
  onAuth,
  error,
  setError,
}: {
  mode: "signin" | "signup";
  setMode: (mode: "signin" | "signup") => void;
  onAuth: (user: User, quota?: Quota, settings?: Settings) => void;
  error: string;
  setError: (value: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ user: User; quota?: Quota }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ username, password }) });
      try {
        const session = await api<{ user: User; quota?: Quota; settings?: Settings }>("/api/me");
        onAuth(session.user, session.quota ?? data.quota, session.settings);
      } catch {
        setError("Signed in, but the browser did not keep the session cookie. Use the same host as the API, allow cookies, and prefer HTTPS.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-panel">
        <div className="brand"><span className="brand-mark">UA</span><span>UnabridgedAI</span></div>
        <div className="auth-kicker">a private interface for open intelligence</div>
        <h1>{mode === "signin" ? "Welcome back." : "Make an account."}</h1>
        <p className="muted">Your channel is yours. No email, no profile, no ceremony.</p>
        <form onSubmit={submit}>
          <label>username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label>password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={10} required /></label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? "opening channel..." : mode === "signin" ? "enter UnabridgedAI ↗" : "create channel ↗"}</button>
        </form>
        <button className="switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}>
          {mode === "signin" ? "new here? create an account" : "already have a channel? sign in"}
        </button>
      </div>
      <div className="auth-art">
        <div className="orbit orbit-a" />
        <div className="orbit orbit-b" />
        <div className="art-copy"><span>04</span><strong>UNRESTRICTED<br />BY DEFAULT</strong><small>built for thinking past the obvious</small></div>
      </div>
    </div>
  );
}
