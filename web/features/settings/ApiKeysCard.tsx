import { useState } from "react";
import { api } from "../../lib/api.ts";

export function ApiKeysCard({ initialKey }: { initialKey?: string | null }) {
  const [key, setKey] = useState(initialKey ?? "");
  const [busy, setBusy] = useState(false);

  const rotate = async () => {
    setBusy(true);
    try {
      const data = await api<{ apiKey: string }>("/api/keys/rotate", { method: "POST" });
      setKey(data.apiKey);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article>
      <div className="eyebrow">your api key</div>
      <p>This key is yours. Call UnabridgedAI through our backend with it. The model provider key never leaves the server.</p>
      <div className="key-reveal">{key ? <code>{key}</code> : <span>UnabridgedAI_••••••••••••••••••••</span>}</div>
      {key && <div className="warning">Copy this now. It will not be shown again.</div>}
      <button className="secondary" disabled={busy} onClick={rotate}>{busy ? "rotating..." : "rotate API key ↻"}</button>
    </article>
  );
}
