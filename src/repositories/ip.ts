import { db } from "../db/client.ts";

export const isIpBlacklisted = (ip: string) =>
  Boolean(db.prepare("SELECT 1 FROM ip_blacklist WHERE ip = ?").get(ip));

export const blacklistIp = (ip: string, reason: string) =>
  db.prepare("INSERT OR IGNORE INTO ip_blacklist VALUES (?, ?, ?)").run(ip, reason, Date.now());

export const recordIpEvent = (ip: string, action: string) =>
  db.prepare("INSERT INTO ip_events VALUES (?, ?, ?)").run(ip, action, Date.now());

export const countIpEvents = (ip: string, action: string, since: number) =>
  (db.prepare("SELECT COUNT(*) AS count FROM ip_events WHERE ip = ? AND action = ? AND created_at > ?").get(ip, action, since) as { count: number }).count;

export const pruneIpEvents = (before: number) =>
  db.prepare("DELETE FROM ip_events WHERE created_at < ?").run(before);
