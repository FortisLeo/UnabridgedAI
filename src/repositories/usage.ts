import { db } from "../db/client.ts";
import { FREE_REQUEST_LIMIT } from "../lib/quota.ts";

export type UserRecord = {
  id: string;
  username: string;
  plan: string;
  requests_used: number;
  signup_ip: string | null;
  created_at: number;
};

export const getUserUsage = (userId: string) =>
  db.prepare("SELECT id, username, plan, requests_used, signup_ip, created_at FROM users WHERE id = ?").get(userId) as UserRecord | undefined;

/**
 * Claim one free request, or a pro request, in the same write that decides the paywall.
 * changes === 0 means a free account was already at the cap.
 */
export const claimRequest = (userId: string) => {
  const result = db
    .prepare("UPDATE users SET requests_used = requests_used + 1 WHERE id = ? AND (plan = 'pro' OR requests_used < ?)")
    .run(userId, FREE_REQUEST_LIMIT);
  return result.changes > 0;
};

export const releaseRequest = (userId: string) => {
  db.prepare("UPDATE users SET requests_used = CASE WHEN requests_used > 0 THEN requests_used - 1 ELSE 0 END WHERE id = ?").run(userId);
};

export const quotaFor = (user: Pick<UserRecord, "plan" | "requests_used">) => {
  const pro = user.plan === "pro";
  return {
    plan: pro ? "pro" : "free",
    requestsUsed: user.requests_used,
    requestsLimit: pro ? null : FREE_REQUEST_LIMIT,
    remaining: pro ? null : Math.max(0, FREE_REQUEST_LIMIT - user.requests_used),
  };
};

