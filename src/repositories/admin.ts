import { db } from "../db/client.ts";

export type AdminActor = string;

export const createAdminSession = (tokenHash: string, expiresAt: number, actor: AdminActor, now = Date.now()) => {
  db.prepare("INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)").run(tokenHash, expiresAt, now);
  recordAudit("admin.login", actor, null, "Admin session created", now);
};

export const findAdminSession = (tokenHash: string) =>
  db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(tokenHash) as { expires_at: number } | undefined;

export const deleteAdminSession = (tokenHash: string) => db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);

export const recordAudit = (action: string, actor: string, target: string | null, detail: string, now = Date.now()) =>
  db.prepare("INSERT INTO admin_audit_events (action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(action, actor, target, detail, now);

export const listAuditEvents = () => db.prepare("SELECT * FROM admin_audit_events ORDER BY created_at DESC LIMIT 300").all();

export const listPaymentPrices = () => db.prepare("SELECT key, value FROM payment_settings ORDER BY key").all() as Array<{ key: string; value: string }>;

export const setPaymentPrice = (key: string, value: string, actor: string, now = Date.now()) => {
  const previous = (db.prepare("SELECT value FROM payment_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
  db.transaction(() => {
    db.prepare("INSERT INTO payment_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    recordAudit("pricing.updated", actor, key, JSON.stringify({ previous, next: value }), now);
  })();
  return { previous, value };
};

export const listWithdrawalRequests = () => db.prepare("SELECT * FROM admin_withdrawals ORDER BY created_at DESC LIMIT 200").all();

export const createWithdrawalRequest = (input: { id: string; chain: string; asset: string; toAddress: string; baseUnits: string; actor: string; now: number }) => {
  db.prepare("INSERT INTO admin_withdrawals (id, chain, asset, to_address, base_units, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'requested', ?, ?, ?)").run(input.id, input.chain, input.asset, input.toAddress, input.baseUnits, input.actor, input.now, input.now);
  recordAudit("withdrawal.requested", input.actor, input.id, JSON.stringify(input), input.now);
};

export const approveWithdrawal = (id: string, actor: string, now = Date.now()) => {
  const result = db.prepare("UPDATE admin_withdrawals SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ? AND status = 'requested'").run(actor, now, id);
  if (!result.changes) return false;
  recordAudit("withdrawal.approved", actor, id, "Approved; signer execution remains disabled", now);
  return true;
};

export const adminOverviewRows = () => ({
  statuses: db.prepare("SELECT status, COUNT(*) AS count FROM payment_invoices GROUP BY status ORDER BY status").all(),
  addressStates: db.prepare("SELECT family, state, COUNT(*) AS count FROM payment_addresses GROUP BY family, state ORDER BY family, state").all(),
  credits: db.prepare("SELECT COUNT(*) AS count FROM payment_credits").get() as { count: number },
  recentEvents: db.prepare("SELECT id, invoice_id, user_id, at, kind, detail FROM payment_events WHERE kind = 'status' ORDER BY at DESC LIMIT 6").all(),
});
