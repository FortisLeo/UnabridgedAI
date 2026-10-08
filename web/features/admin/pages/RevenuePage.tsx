import { Panel, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

export function RevenuePage({ data }: { data: AdminData }) {
  return <><Panel title="revenue by chain"><Table rows={(data.byChain as Array<Record<string, unknown>> | undefined) ?? []} columns={["chain", "invoices", "paid"]} /></Panel><Panel title="revenue by asset"><Table rows={(data.byAsset as Array<Record<string, unknown>> | undefined) ?? []} columns={["asset", "invoices", "paid"]} /></Panel></>;
}
