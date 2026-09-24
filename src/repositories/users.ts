import { db } from "../db/client.ts";
import type { UserRecord } from "./usage.ts";

export const insertUser = (id: string, username: string, passwordHash: string, createdAt: number, signupIp: string) =>
  db.prepare("INSERT INTO users (id, username, password_hash, plan, requests_used, signup_ip, created_at) VALUES (?, ?, ?, 'free', 0, ?, ?)").run(
    id,
    username,
    passwordHash,
    signupIp,
    createdAt,
  );

export const findUserByUsername = (username: string) =>
  db.prepare("SELECT id, username, password_hash, plan, requests_used FROM users WHERE username = ?").get(username) as
    | { id: string; username: string; password_hash: string; plan: string; requests_used: number }
    | undefined;

export const findUserById = (id: string) =>
  db.prepare("SELECT id, username, plan, requests_used, created_at FROM users WHERE id = ?").get(id) as
    | { id: string; username: string; plan: string; requests_used: number; created_at: number }
    | undefined;

export const countSignupsFromIp = (ip: string, since: number) =>
  (db.prepare("SELECT COUNT(*) AS count FROM users WHERE signup_ip = ? AND created_at > ?").get(ip, since) as { count: number }).count;

export type { UserRecord };
