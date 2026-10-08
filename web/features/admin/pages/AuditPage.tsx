import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function AuditPage({ data }: { data: AdminData }) {
  return <Panel title="admin audit log"><Table rows={(data.events as Array<Record<string, unknown>> | undefined) ?? []} columns={["id", "action", "actor", "target", "detail", "created_at"]} /></Panel>;
}
