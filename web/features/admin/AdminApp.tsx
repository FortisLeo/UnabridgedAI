import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { AdminAuth, AdminLoading, AdminShell } from "./components/index.ts";
import {
  AuditPage,
  BalancesPage,
  OverviewPage,
  PaymentsPage,
  RevenuePage,
  SettingsPage,
  UnmatchedPage,
  WebhooksPage,
  WithdrawalsPage,
} from "./pages/index.ts";
import type { AdminData, OverviewData, Section } from "./types.ts";

const endpointFor = (section: Section) => `/api/admin/${section === "dashboard" ? "overview" : section}`;

export function AdminApp() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [section, setSection] = useState<Section>("dashboard");
  const [data, setData] = useState<AdminData | null>(null);
  const [loadedSection, setLoadedSection] = useState<Section | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);

  const load = async (next: Section = section) => {
    const sequence = ++requestSequence.current;
    try {
      const payload = await api<AdminData>(endpointFor(next));
      if (sequence !== requestSequence.current) return;
      setData(payload);
      setLoadedSection(next);
      setLoggedIn(true);
      setAuthChecked(true);
      setError("");
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      setAuthChecked(true);
      if ((err as { status?: number }).status === 401) {
        setLoggedIn(false);
        setData(null);
        setLoadedSection(null);
      } else {
        setError((err as Error).message);
      }
    }
  };

  useEffect(() => {
    setData(null);
    setLoadedSection(null);
    void load(section);
  }, [section]);

  const login = async (username: string, password: string) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      await load(section);
    } catch (err) {
      setAuthChecked(true);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" });
    setLoggedIn(false);
    setData(null);
    setLoadedSection(null);
  };

  if (!authChecked) return <AdminLoading error="" onRetry={() => void load(section)} />;
  if (!loggedIn) return <AdminAuth busy={busy} error={error} onLogin={login} />;
  if (!data || loadedSection !== section) return <AdminLoading error={error} onRetry={() => void load(section)} />;

  return (
    <AdminShell section={section} onSectionChange={setSection} onRefresh={() => void load(section)} onLogout={logout}>
      <AdminPage section={section} data={data} />
    </AdminShell>
  );
}

function AdminPage({ section, data }: { section: Section; data: AdminData }) {
  switch (section) {
    case "dashboard": return <OverviewPage data={data as unknown as OverviewData} />;
    case "payments": return <PaymentsPage data={data} />;
    case "balances": return <BalancesPage data={data} />;
    case "withdrawals": return <WithdrawalsPage data={data} />;
    case "analytics": return <RevenuePage data={data} />;
    case "webhooks": return <WebhooksPage data={data} />;
    case "settings": return <SettingsPage data={data} />;
    case "unmatched": return <UnmatchedPage data={data} />;
    case "audit": return <AuditPage data={data} />;
  }
}
