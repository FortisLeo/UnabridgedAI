import { db } from "../db/client.ts";
import { hash, makeApiKey, randomUUID } from "../lib/crypto.ts";

export type ApiKeyRow = {
  id: string;
  user_id: string;
  prefix: string;
  name: string;
  created_at: number;
  revoked_at: number | null;
};

const publicRow = (row: ApiKeyRow) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  created_at: row.created_at,
  revoked_at: row.revoked_at,
});

export const issueApiKey = (userId: string, name = "default") => {
  const key = makeApiKey();
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    "INSERT INTO api_keys (id, user_id, key_hash, prefix, created_at, revoked_at, name) VALUES (?, ?, ?, ?, ?, NULL, ?)",
  ).run(id, userId, hash(key), key.slice(0, 16), createdAt, name.trim() || "default");
  return { id, name: name.trim() || "default", prefix: key.slice(0, 16), created_at: createdAt, key };
};

export const listApiKeys = (userId: string) =>
  (db.prepare("SELECT id, user_id, prefix, name, created_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ApiKeyRow[]).map(publicRow);

export const listActiveApiKeys = (userId: string) =>
  (db.prepare("SELECT id, user_id, prefix, name, created_at, revoked_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC").all(userId) as ApiKeyRow[]).map(publicRow);

export const countActiveApiKeys = (userId: string) =>
  (db.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ? AND revoked_at IS NULL").get(userId) as { count: number }).count;

export const findApiKey = (userId: string, id: string) =>
  db.prepare("SELECT id, user_id, prefix, name, created_at, revoked_at FROM api_keys WHERE id = ? AND user_id = ?").get(id, userId) as ApiKeyRow | undefined;

export const findActiveApiKey = (key: string) =>
  db.prepare("SELECT id, user_id, prefix, name, created_at, revoked_at FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(hash(key)) as ApiKeyRow | undefined;

export const renameApiKey = (userId: string, id: string, name: string) => {
  const result = db.prepare("UPDATE api_keys SET name = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").run(name.trim() || "default", id, userId);
  return result.changes > 0;
};

export const revokeApiKey = (userId: string, id: string) => {
  const result = db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").run(Date.now(), id, userId);
  return result.changes > 0;
};

export const revokeActiveApiKeys = (userId: string) =>
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(Date.now(), userId);
