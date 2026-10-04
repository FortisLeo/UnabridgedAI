import { db } from "../db/client.ts";

export const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;

export const paymentSearch = (query: string, status: string, limit: number, offset: number) => {
  const q = `%${query.trim()}%`;
  return db.prepare(`SELECT id, user_id, chain, asset, expected_base_units, address, status, created_at, settled_at
    FROM payment_invoices
    WHERE (id LIKE ? OR user_id LIKE ? OR address LIKE ?) AND (? = '' OR status = ?)
    ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(q, q, q, status, status, limit, offset);
};

export const balancesSummary = () => ({
  addresses: db.prepare("SELECT family, state, COUNT(*) AS count FROM payment_addresses GROUP BY family, state").all(),
  credits: db.prepare("SELECT chain, COUNT(*) AS count, COALESCE(SUM(CAST(base_units AS INTEGER)), 0) AS baseUnits FROM payment_credits WHERE disappeared_at IS NULL GROUP BY chain").all(),
  health: db.prepare("SELECT * FROM chain_health ORDER BY chain").all(),
});

export const sweepRows = () => {
  db.exec(`CREATE TABLE IF NOT EXISTS payment_address_sweeps (
    id TEXT PRIMARY KEY, chain TEXT NOT NULL, asset TEXT NOT NULL, token_contract TEXT NOT NULL,
    from_address TEXT NOT NULL, derivation_index INTEGER NOT NULL, to_address TEXT NOT NULL,
    base_units TEXT NOT NULL, nonce INTEGER NOT NULL, gas_price TEXT NOT NULL, gas_limit INTEGER NOT NULL,
    unsigned_tx TEXT NOT NULL, created_at INTEGER NOT NULL, broadcast_tx TEXT, broadcast_at INTEGER, confirmed_at INTEGER
  )`);
  return db.prepare("SELECT id, chain, asset, base_units, from_address, to_address, broadcast_tx, broadcast_at, created_at, confirmed_at FROM payment_address_sweeps ORDER BY created_at DESC LIMIT 200").all();
};
export const revenueRows = () => ({
  byChain: db.prepare("SELECT chain, COUNT(*) AS invoices, SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS paid FROM payment_invoices GROUP BY chain").all(),
  byAsset: db.prepare("SELECT asset, COUNT(*) AS invoices, SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS paid FROM payment_invoices GROUP BY asset").all(),
});
export const webhookRows = () => ({
  endpoints: db.prepare("SELECT id, url, created_at FROM payment_webhook_endpoints").all(),
  deliveries: db.prepare("SELECT id, invoice_id, event, created_at, next_attempt_at, delivered_at FROM payment_webhook_deliveries ORDER BY created_at DESC LIMIT 200").all(),
});
export const unmatchedRows = () => db.prepare("SELECT * FROM unmatched_transfers WHERE status = 'unreviewed' ORDER BY first_seen_at DESC LIMIT 200").all();
