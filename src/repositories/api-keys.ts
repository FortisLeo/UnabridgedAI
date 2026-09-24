import { db } from "../db/client.ts";
import { hash, makeApiKey, randomUUID } from "../lib/crypto.ts";

export type ApiKeyRow = {
  id: string;
  user_id: string;
  prefix: string;
  created_at: number;
  revoked_at: number | null;
};

export const issueApiKey = (userId: string) => {
  const key = makeApiKey();
  db.prepare("INSERT INTO api_keys VALUES (?, ?, ?, ?, ?, NULL)").run(
    randomUUID(),
    userId,
    hash(key),
    key.slice(0, 12),
    Date.now(),
  );
  return key;
};

export const listApiKeys = (userId: string) =>
  db.prepare("SELECT id, prefix, created_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ApiKeyRow[];

export const findActiveApiKey = (key: string) =>
  db.prepare("SELECT id, user_id, prefix, created_at, revoked_at FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(hash(key)) as ApiKeyRow | undefined;

export const revokeActiveApiKeys = (userId: string) =>
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(Date.now(), userId);
