import { db } from "../db/client.ts";

export const insertSession = (idHash: string, userId: string, expiresAt: number) =>
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(idHash, userId, expiresAt);

export const findSessionUser = (idHash: string, now: number) => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return db.prepare("SELECT user_id FROM sessions WHERE id_hash = ? AND expires_at > ?").get(idHash, now) as
    | { user_id: string }
    | undefined;
};

export const deleteSession = (idHash: string) =>
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);

export const deleteUserSessions = (userId: string) =>
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

export const countUserSessions = (userId: string) =>
  (db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(userId) as { count: number }).count;
