import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function PaymentsPage({ data }: { data: AdminData }) {
  return <Panel title="payment queue"><Table scrollable rows={(data.invoices as Array<Record<string, unknown>> | undefined) ?? []} columns={["id", "user_id", "chain", "asset", "expected_base_units", "status", "created_at", "settled_at"]} /></Panel>;
}
