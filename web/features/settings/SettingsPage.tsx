import { useEffect, useState } from "react";
import { Toggle } from "../../components/Toggle.tsx";
import { api } from "../../lib/api.ts";
import { defaultSettings, type Settings } from "../../types.ts";
import { ApiKeysCard } from "./ApiKeysCard.tsx";

export function SettingsPage({
  settings,
  setSettings,
  issuedApiKey,
  onHistoryCleared,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  issuedApiKey?: string | null;
  onHistoryCleared: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(settings), [settings]);

  const save = async (patch: Partial<Settings> = draft) => {
    setBusy(true);
    setStatus("");
    try {
      const data = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
      const next = { ...defaultSettings, ...data.settings };
      setSettings(next);
      setDraft(next);
      setStatus("saved");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    const data = await api("/api/data/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "UnabridgedAI-export.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="settings">
      <div className="settings-intro">
        <p>Memory, history, search defaults, and data controls for this workspace.</p>
        {status && <div className="status-pill">{status}</div>}
      </div>
      <div className="settings-grid">
        <article>
          <div className="eyebrow">personalization</div>
          <Toggle label="Memory" hint="Keep useful facts between sessions." on={draft.memoryEnabled} onChange={(value) => { setDraft({ ...draft, memoryEnabled: value }); save({ memoryEnabled: value }); }} />
          <label>what should UnabridgedAI remember<textarea value={draft.memory} onChange={(event) => setDraft({ ...draft, memory: event.target.value })} placeholder="Preferred tone, ongoing projects, constraints..." /></label>
          <label>custom instructions<textarea value={draft.customInstructions} onChange={(event) => setDraft({ ...draft, customInstructions: event.target.value })} placeholder="Always be blunt. Never pad answers." /></label>
          <button className="primary" disabled={busy} onClick={() => save()}>save personalization</button>
        </article>
        <article>
          <div className="eyebrow">session controls</div>
          <Toggle label="Save chat history" hint="Store sessions in the left panel." on={draft.saveHistory} onChange={(value) => { setDraft({ ...draft, saveHistory: value }); save({ saveHistory: value }); }} />
          <Toggle label="Web search by default" hint="Attach public search results to new messages." on={draft.webSearch} onChange={(value) => { setDraft({ ...draft, webSearch: value }); save({ webSearch: value }); }} />
          <Toggle label="Dark web search by default" hint="Include publicly indexed onion results." on={draft.darkWebSearch} onChange={(value) => { setDraft({ ...draft, darkWebSearch: value }); save({ darkWebSearch: value }); }} />
        </article>
        <ApiKeysCard initialKey={issuedApiKey} />
        <article>
          <div className="eyebrow">data controls</div>
          <p>Export or wipe stored sessions. Memory and instructions stay until you clear them.</p>
          <div className="row-actions">
            <button className="secondary" onClick={exportData}>export data</button>
            <button className="danger" onClick={async () => { await api("/api/data/chats", { method: "DELETE" }); await onHistoryCleared(); setStatus("history cleared"); }}>delete all chats</button>
          </div>
        </article>
      </div>
    </section>
  );
}
