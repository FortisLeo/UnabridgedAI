import { useState, type FormEvent } from "react";

export function AdminAuth({ busy, error, onLogin }: { busy: boolean; error: string; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onLogin(username, password);
  };

  return (
    <div className="admin-auth">
      <div className="brand"><span className="brand-mark">UA</span><span>UnabridgedAI</span></div>
      <div className="eyebrow">restricted operations</div>
      <h1>Admin console</h1>
      <p className="muted">Payment and infrastructure visibility for authorized operators.</p>
      <form onSubmit={submit}>
        <label>username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
        <label>password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "authenticating..." : "open console ↗"}</button>
      </form>
    </div>
  );
}
