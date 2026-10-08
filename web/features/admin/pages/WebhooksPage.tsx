import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function WebhooksPage({ data }: { data: AdminData }) {
  return <><Panel title="endpoints"><Table rows={(data.endpoints as Array<Record<string, unknown>> | undefined) ?? []} columns={["id", "url", "created_at"]} /></Panel><Panel title="deliveries"><Table rows={(data.deliveries as Array<Record<string, unknown>> | undefined) ?? []} columns={["id", "invoice_id", "event", "created_at", "delivered_at"]} /></Panel></>;
}
