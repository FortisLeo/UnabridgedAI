import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function BalancesPage({ data }: { data: AdminData }) {
  const pool = (data.pool as Array<Record<string, unknown>> | undefined) ?? [];
  const error = typeof data.error === "string" ? data.error : "";
  const rows = pool.map((row) => ({ ...row, assets: Array.isArray(row.assets) ? (row.assets as Array<{ asset: string; tokenBalance: string }>).map((asset) => `${asset.asset}: ${asset.tokenBalance}`).join(" · ") : "-" }));
  return <>{error && <div className="admin-inline-warning">{error}</div>}<Panel title="EVM address pool"><Table rows={rows} columns={["address", "derivationIndex", "chain", "state", "invoiceId", "leaseExpiresAt", "nativeBalanceBaseUnits", "assets"]} /></Panel><Panel title="address inventory"><Table rows={(data.addresses as Array<Record<string, unknown>> | undefined) ?? []} columns={["family", "state", "count"]} /></Panel><Panel title="observed credits"><Table rows={(data.credits as Array<Record<string, unknown>> | undefined) ?? []} columns={["chain", "count", "baseUnits"]} /></Panel></>;
}
