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
db.exec("DROP INDEX IF EXISTS users_username_lower");
const normalizeUsername = db.prepare("UPDATE users SET username_lower = lower(trim(username)) WHERE id = ?");
for (const row of db.prepare("SELECT id FROM users").all() as Array<{ id: string }>) normalizeUsername.run(row.id);
const duplicateUsers = db.prepare(`
  SELECT username_lower
  FROM users
  GROUP BY username_lower
  HAVING COUNT(*) > 1
`).all() as Array<{ username_lower: string }>;
const mergeDuplicate = db.transaction((usernameLower: string) => {
  const users = db.prepare("SELECT id FROM users WHERE username_lower = ? ORDER BY created_at ASC, id ASC").all(usernameLower) as Array<{ id: string }>;
  const [keeper, ...duplicates] = users;
  if (!keeper) return;
  for (const duplicate of duplicates) {
    db.prepare("UPDATE sessions SET user_id = ? WHERE user_id = ?").run(keeper.id, duplicate.id);
    db.prepare("UPDATE api_keys SET user_id = ? WHERE user_id = ?").run(keeper.id, duplicate.id);
    db.prepare("UPDATE chats SET user_id = ? WHERE user_id = ?").run(keeper.id, duplicate.id);
    db.prepare("DELETE FROM settings WHERE user_id = ? AND EXISTS (SELECT 1 FROM settings WHERE user_id = ?)").run(duplicate.id, keeper.id);
    db.prepare("UPDATE settings SET user_id = ? WHERE user_id = ?").run(keeper.id, duplicate.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(duplicate.id);
  }
});
for (const row of duplicateUsers) mergeDuplicate(row.username_lower);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (username_lower)");
const keyColumns = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
if (!keyColumns.some((column) => column.name === "name")) db.exec("ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT 'default'");
db.exec("DROP TABLE IF EXISTS payments");
// Rate-limit counters on loopback were a local-dev lockout, not a block list.
// Blacklist rows stay: a private address can be blocked on purpose.
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
