import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { ApiKey } from "../../types.ts";

export function ApiPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("Open WebUI");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const origin = typeof window === "undefined" ? "http://localhost:3001" : window.location.origin;

  const load = async () => {
    const data = await api<{ keys: ApiKey[] }>("/api/keys");
    setKeys(data.keys);
  };

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ key: ApiKey; secret: string }>("/api/keys", { method: "POST", body: JSON.stringify({ name }) });
      setSecret(data.secret);
      setName("Open WebUI");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/keys/${id}`, { method: "PATCH", body: JSON.stringify({ name: draft }) });
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? Clients using it will stop working.")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/keys/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const active = keys.filter((key) => !key.revoked_at);
  const revoked = keys.filter((key) => key.revoked_at);

  return (
    <section className="api-page">
      <div className="plan-card">
        <div className="plan-top"><span className="tag">OPENAI COMPATIBLE</span><span className="price">/v1</span></div>
        <h2>Keys for this workspace.</h2>
        <p>Create named keys and plug them into Open WebUI or any OpenAI-compatible SDK. Docs are in the top right.</p>
        <div className="payment">
          <span>base URL</span>
          <code>{origin}/v1</code>
          <button className="secondary" onClick={() => copy(`${origin}/v1`)}>copy URL</button>
        </div>
        <label>key name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Open WebUI" maxLength={64} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" onClick={create} disabled={busy}>{busy ? "creating..." : "create API key ↗"}</button>
        {secret && (
          <div className="key-reveal">
            <code>{secret}</code>
            <div className="warning">Copy this now. It will not be shown again.</div>
            <button className="secondary" onClick={() => copy(secret)}>copy secret</button>
          </div>
        )}
        <div className="key-list">
          {active.length === 0 ? <div className="empty-chats">no active keys</div> : active.map((key) => (
            <div className="key-row" key={key.id}>
              {editing === key.id ? (
                <form onSubmit={(event) => { event.preventDefault(); rename(key.id); }}>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
                </form>
              ) : (
                <strong>{key.name}</strong>
              )}
              <code>{key.prefix}…</code>
              <small>{timeAgo(key.created_at)}</small>
              <div className="row-actions">
                {editing === key.id ? (
                  <button className="secondary" disabled={busy} onClick={() => rename(key.id)}>save</button>
                ) : (
                  <button className="secondary" onClick={() => { setEditing(key.id); setDraft(key.name); }}>rename</button>
                )}
                <button className="danger" disabled={busy} onClick={() => revoke(key.id)}>revoke</button>
              </div>
            </div>
          ))}
        </div>
        {revoked.length > 0 && (
          <div className="revoked">
            <div className="eyebrow">revoked</div>
            {revoked.map((key) => (
              <div className="key-row muted" key={key.id}>
                <strong>{key.name}</strong>
                <code>{key.prefix}…</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
