import Database from "better-sqlite3";
import { env } from "../lib/env.ts";
import { schema } from "./schema.ts";

export const db = new Database(env.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(schema);
db.prepare("UPDATE settings SET model = 'grok-4.5' WHERE model = 'gpt-5.5'").run();
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "requests_used")) db.exec("ALTER TABLE users ADD COLUMN requests_used INTEGER NOT NULL DEFAULT 0");
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
db.exec("DROP TABLE IF EXISTS payments");
// Rate-limit counters on loopback were a local-dev lockout, not a block list.
// Blacklist rows stay: a private address can be blocked on purpose.
db.exec("INSERT OR IGNORE INTO address_counters (family, next_index) VALUES ('evm', 0), ('solana', 0), ('monero', 1)");
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
