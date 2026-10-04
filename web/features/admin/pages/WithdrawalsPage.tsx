import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function WithdrawalsPage({ data }: { data: AdminData }) {
  return <Panel title="sweep records"><p className="muted">Read-only view. Fund-moving actions require a signer, approval policy, and audit trail.</p><Table rows={(data.sweeps as Array<Record<string, unknown>> | undefined) ?? []} columns={["id", "invoice_id", "chain", "asset", "base_units", "from_address", "to_address", "broadcast_tx", "created_at"]} /></Panel>;
}
