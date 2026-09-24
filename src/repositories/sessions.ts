import { db } from "../db/client.ts";

export const insertSession = (idHash: string, userId: string, expiresAt: number) =>
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(idHash, userId, expiresAt);

export const findSessionUser = (idHash: string, now: number) =>
  db.prepare("SELECT user_id FROM sessions WHERE id_hash = ? AND expires_at > ?").get(idHash, now) as
    | { user_id: string }
    | undefined;

export const deleteSession = (idHash: string) =>
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
