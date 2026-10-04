import Database from "better-sqlite3";
import { env } from "../lib/env.ts";
import { schema } from "./schema.ts";

export const db = new Database(env.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(schema);
db.prepare("UPDATE settings SET model = 'grok-4.5' WHERE model = 'gpt-5.5'").run();
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "pro_expires_at")) db.exec("ALTER TABLE users ADD COLUMN pro_expires_at INTEGER");
// Preserve legacy Pro grants by deriving their first expiry from the latest settled invoice.
db.prepare(`
  UPDATE users
  SET pro_expires_at = (
    SELECT settled_at + 28 * 24 * 60 * 60 * 1000
    FROM payment_invoices
    WHERE payment_invoices.user_id = users.id AND payment_invoices.status = 'succeeded' AND payment_invoices.settled_at IS NOT NULL
    ORDER BY settled_at DESC LIMIT 1
  )
  WHERE plan = 'pro' AND pro_expires_at IS NULL
`).run();
if (!userColumns.some((column) => column.name === "requests_used")) db.exec("ALTER TABLE users ADD COLUMN requests_used INTEGER NOT NULL DEFAULT 0");
const addressColumns = db.prepare("PRAGMA table_info(payment_addresses)").all() as Array<{ name: string }>;
if (!addressColumns.some((column) => column.name === "lease_expires_at")) db.exec("ALTER TABLE payment_addresses ADD COLUMN lease_expires_at INTEGER");
if (!addressColumns.some((column) => column.name === "reusable_at")) db.exec("ALTER TABLE payment_addresses ADD COLUMN reusable_at INTEGER");
if (!addressColumns.some((column) => column.name === "last_balance_base_units")) db.exec("ALTER TABLE payment_addresses ADD COLUMN last_balance_base_units TEXT");
if (!addressColumns.some((column) => column.name === "last_checked_at")) db.exec("ALTER TABLE payment_addresses ADD COLUMN last_checked_at INTEGER");
if (!userColumns.some((column) => column.name === "signup_ip")) db.exec("ALTER TABLE users ADD COLUMN signup_ip TEXT");
if (!userColumns.some((column) => column.name === "username_lower")) db.exec("ALTER TABLE users ADD COLUMN username_lower TEXT");
db.transaction(() => {
  db.exec("DROP INDEX IF EXISTS users_username_lower");
  db.exec("UPDATE users SET username_lower = lower(trim(username))");
  const duplicates = db.prepare(`
    SELECT newer.id, older.id AS keeper_id
    FROM users AS newer
    JOIN users AS older ON older.username_lower = newer.username_lower
    WHERE older.id = (
      SELECT id FROM users WHERE username_lower = newer.username_lower
      ORDER BY created_at ASC, id ASC LIMIT 1
    ) AND newer.id != older.id
  `).all() as Array<{ id: string; keeper_id: string }>;
  for (const duplicate of duplicates) {
    db.prepare("UPDATE chats SET user_id = ? WHERE user_id = ?").run(duplicate.keeper_id, duplicate.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(duplicate.id);
    db.prepare("DELETE FROM api_keys WHERE user_id = ?").run(duplicate.id);
    db.prepare("DELETE FROM settings WHERE user_id = ?").run(duplicate.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(duplicate.id);
  }
  db.exec("CREATE UNIQUE INDEX users_username_lower ON users (username_lower)");
})();
const keyColumns = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
if (!keyColumns.some((column) => column.name === "name")) db.exec("ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT 'default'");
const chatColumns = db.prepare("PRAGMA table_info(chats)").all() as Array<{ name: string }>;
if (chatColumns.length && !chatColumns.some((column) => column.name === "pinned")) db.exec("ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
db.exec("DROP TABLE IF EXISTS payments");
// Rate-limit counters on loopback were a local-dev lockout, not a block list.
// Blacklist rows stay: a private address can be blocked on purpose.
db.exec("INSERT OR IGNORE INTO address_counters (family, next_index) VALUES ('evm', 0), ('solana', 0), ('monero', 1)");
const invoiceIndexes = db.prepare("PRAGMA index_list(payment_invoices)").all() as Array<{ name: string; unique: number }>; 
const uniqueAddressIndex = invoiceIndexes.find((index) => index.unique === 1 && (db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string | null }>).some((column) => column.name === "address"));
if (uniqueAddressIndex) {
  db.pragma("foreign_keys = OFF");
  db.transaction(() => {
    db.exec(`CREATE TABLE payment_invoices_pool (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, chain TEXT NOT NULL, asset TEXT NOT NULL, token_contract TEXT,
      expected_base_units TEXT NOT NULL, address TEXT NOT NULL, derivation_index INTEGER NOT NULL, status TEXT NOT NULL,
      qr_expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, settled_at INTEGER,
      grant_applied_at INTEGER, already_pro INTEGER NOT NULL DEFAULT 0, refund_address TEXT, refund_chain TEXT,
      refund_requested_at INTEGER, note TEXT, uri TEXT, second_read_ok INTEGER NOT NULL DEFAULT 0, swept_at INTEGER, sweep_tx TEXT
    )`);
    db.exec("INSERT INTO payment_invoices_pool SELECT id, user_id, chain, asset, token_contract, expected_base_units, address, derivation_index, status, qr_expires_at, created_at, updated_at, settled_at, grant_applied_at, already_pro, refund_address, refund_chain, refund_requested_at, note, uri, second_read_ok, swept_at, sweep_tx FROM payment_invoices");
    db.exec("DROP TABLE payment_invoices");
    db.exec("ALTER TABLE payment_invoices_pool RENAME TO payment_invoices");
    db.exec("CREATE INDEX payment_invoices_user ON payment_invoices (user_id, created_at DESC)");
    db.exec("CREATE INDEX payment_invoices_status ON payment_invoices (status, chain)");
  })();
  db.pragma("foreign_keys = ON");
}
const creditColumns = db.prepare("PRAGMA table_info(payment_credits)").all() as Array<{ name: string }>;
if (!creditColumns.some((column) => column.name === "confirmed_at")) db.exec("ALTER TABLE payment_credits ADD COLUMN confirmed_at INTEGER");
const invoiceColumns = db.prepare("PRAGMA table_info(payment_invoices)").all() as Array<{ name: string }>;
if (!invoiceColumns.some((column) => column.name === "swept_at")) db.exec("ALTER TABLE payment_invoices ADD COLUMN swept_at INTEGER");
if (!invoiceColumns.some((column) => column.name === "sweep_tx")) db.exec("ALTER TABLE payment_invoices ADD COLUMN sweep_tx TEXT");
db.prepare(
  "DELETE FROM ip_events WHERE ip IN ('127.0.0.1', '::1', 'localhost', 'unknown') OR ip LIKE '127.%' OR ip LIKE '192.168.%' OR ip LIKE '10.%'",
).run();

export const closeDb = () => {
  try {
    db.close();
  } catch {
    // already closed
  }
};
