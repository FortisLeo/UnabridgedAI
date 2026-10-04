export type Section =
  | "dashboard"
  | "payments"
  | "balances"
  | "withdrawals"
  | "analytics"
  | "webhooks"
  | "settings"
  | "unmatched"
  | "audit";

export const sectionLabels: Record<Section, string> = {
  dashboard: "Overview",
  payments: "Payments",
  balances: "Balances",
  withdrawals: "Withdrawals",
  analytics: "Revenue",
  webhooks: "Webhooks",
  settings: "Settings",
  unmatched: "Unmatched",
  audit: "Audit log",
};

export type AdminData = Record<string, unknown>;

export type OverviewData = {
  users: number;
  chats: number;
  invoices: number;
  credits: number;
  proUsers: number;
  activeInvoices: number;
  paidLast7d: number;
  revenueLast7d: { usd: number; payments: number };
  statuses: Array<{ status: string; count: number }>;
  addressStates: Array<{ family: string; state: string; count: number }>;
  prices: Array<{ key: string; value: string }>;
  recentEvents: Array<{ id: number; invoice_id: string; at: number; kind: string; detail: string }>;
  riskNotices: string[];
  chains: Record<string, { rpcConfigured: boolean; rpcCount: number }>;
};
