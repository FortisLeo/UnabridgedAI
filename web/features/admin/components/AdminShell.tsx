import type { ReactNode } from "react";
import { sectionLabels, type Section } from "../types.ts";

export function AdminShell({ section, children, onSectionChange, onRefresh, onLogout }: { section: Section; children: ReactNode; onSectionChange: (section: Section) => void; onRefresh: () => void; onLogout: () => Promise<void> }) {
  return (
    <div className={`admin-shell ${section === "dashboard" ? "admin-overview" : ""}`}>
      <header className="admin-header">
        <div><div className="eyebrow">operations / sqlite</div><h1>{sectionLabels[section]}</h1></div>
        <div className="admin-actions"><button className="secondary" onClick={onRefresh}>refresh</button><button className="secondary" onClick={() => void onLogout()}>sign out</button></div>
      </header>
      <div className="admin-layout">
        <nav className="admin-nav">
          {(Object.keys(sectionLabels) as Section[]).map((item) => (
            <button className={item === section ? "active" : ""} key={item} onClick={() => onSectionChange(item)}>{sectionLabels[item]}</button>
          ))}
        </nav>
        <div className="admin-content" role="main">{children}</div>
      </div>
    </div>
  );
}

export function AdminLoading({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="admin-shell admin-loading">
      <div className="eyebrow">loading operations data</div>
      {error ? <><span className="error">{error}</span><button className="secondary" onClick={onRetry}>retry</button></> : <span>reading SQLite state...</span>}
    </div>
  );
}
