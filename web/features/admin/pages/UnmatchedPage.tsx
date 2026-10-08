import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function UnmatchedPage({ data }: { data: AdminData }) {
  return <Panel title="unmatched transfers"><Table rows={(data.transfers as Array<Record<string, unknown>> | undefined) ?? []} columns={["id", "chain", "asset", "tx_hash", "to_address", "base_units", "status", "first_seen_at"]} /></Panel>;
}
