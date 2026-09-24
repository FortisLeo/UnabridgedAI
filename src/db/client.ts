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
const keyColumns = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
if (!keyColumns.some((column) => column.name === "name")) db.exec("ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT 'default'");
db.exec("DROP TABLE IF EXISTS payments");
db.prepare(
  "DELETE FROM ip_events WHERE ip IN ('127.0.0.1', '::1', 'localhost', 'unknown') OR ip LIKE '127.%' OR ip LIKE '192.168.%' OR ip LIKE '10.%'",
).run();
db.prepare(
  "DELETE FROM ip_blacklist WHERE ip IN ('127.0.0.1', '::1', 'localhost', 'unknown') OR ip LIKE '127.%' OR ip LIKE '192.168.%' OR ip LIKE '10.%'",
).run();

export const closeDb = () => {
  try {
    db.close();
  } catch {
    // already closed
  }
};
