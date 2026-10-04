import type { ReactNode } from "react";
import { Events, Panel, Rows } from "../components/AdminPanel.tsx";
import type { OverviewData } from "../types.ts";

export function OverviewPage({ data }: { data: OverviewData }) {
  const riskNotices = data.riskNotices ?? [];
  const statuses = data.statuses ?? [];
  const addressStates = data.addressStates ?? [];
  const recentEvents = data.recentEvents ?? [];
  const chains = data.chains ?? {};
  const metrics: Array<[string, ReactNode, string]> = [
    ["users", data.users, "accounts"],
    ["active pro", data.proUsers, "current access"],
    ["active invoices", data.activeInvoices, "awaiting payment"],
    ["paid 7d", data.paidLast7d, "settled payments"],
    ["credits", data.credits, "on-chain records"],
    ["all invoices", data.invoices, "lifetime"],
    ["chats", data.chats, "saved sessions"],
    ["revenue / 7d", `$${(data.revenueLast7d?.usd ?? 0).toFixed(2)}`, "stablecoin payments"],
  ];

  return (
    <>
      <div className="admin-section-intro"><div><div className="eyebrow">operator snapshot</div><p>Payment activity, access status, and infrastructure readiness across the last seven days.</p></div><span className="admin-refresh-note">live SQLite view · refresh for latest</span></div>
      <div className="admin-metrics">{metrics.map(([label, value, hint]) => <div className="admin-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
      <div className="admin-grid">
        <Panel title="risk notices">{riskNotices.length ? <ul className="admin-notices">{riskNotices.map((notice) => <li key={notice}>{notice}</li>)}</ul> : <p className="admin-ok">No current configuration notices.</p>}</Panel>
        <Panel title="chain health"><Rows items={Object.entries(chains).map(([chain, state]) => ({ label: chain, value: <span className={state.rpcConfigured ? "admin-ok" : "admin-bad"}>{state.rpcConfigured ? `${state.rpcCount} RPC configured` : "not configured"}</span> }))} /></Panel>
        <Panel title="invoice statuses"><Rows items={statuses.map((item) => ({ label: item.status, value: item.count }))} /></Panel>
        <Panel title="address pool"><Rows items={addressStates.map((item) => ({ label: `${item.family} / ${item.state}`, value: item.count }))} /></Panel>
      </div>
      <Panel className="admin-recent-payments" title="recent payments"><Events events={recentEvents} /></Panel>
    </>
  );
}
