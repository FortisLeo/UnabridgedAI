import { db } from "../db/client.ts";
import { FREE_REQUEST_LIMIT } from "../lib/quota.ts";
import { proActive } from "../lib/subscription.ts";

export type UserRecord = {
  id: string;
  username: string;
  plan: string;
  pro_expires_at: number | null;
  requests_used: number;
  signup_ip: string | null;
  created_at: number;
};

export const getUserUsage = (userId: string) =>
  db.prepare("SELECT id, username, plan, pro_expires_at, requests_used, signup_ip, created_at FROM users WHERE id = ?").get(userId) as UserRecord | undefined;

/**
 * Claim one free request, or a pro request, in the same write that decides the paywall.
 * changes === 0 means a free account was already at the cap.
 */
export const claimRequest = (userId: string) => {
  const result = db
    .prepare("UPDATE users SET requests_used = requests_used + 1 WHERE id = ? AND ((plan = 'pro' AND pro_expires_at > ?) OR requests_used < ?)")
    .run(userId, Date.now(), FREE_REQUEST_LIMIT);
  return result.changes > 0;
};

export const releaseRequest = (userId: string) => {
  db.prepare("UPDATE users SET requests_used = CASE WHEN requests_used > 0 THEN requests_used - 1 ELSE 0 END WHERE id = ?").run(userId);
};

export const quotaFor = (user: Pick<UserRecord, "plan" | "pro_expires_at" | "requests_used">) => {
  const pro = proActive(user.plan, user.pro_expires_at);
  return {
    plan: pro ? "pro" : "free",
    requestsUsed: user.requests_used,
    requestsLimit: pro ? null : FREE_REQUEST_LIMIT,
    remaining: pro ? null : Math.max(0, FREE_REQUEST_LIMIT - user.requests_used),
    proExpiresAt: pro ? user.pro_expires_at : null,
  };
};

