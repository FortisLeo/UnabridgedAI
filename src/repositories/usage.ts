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

export const incrementRequests = (userId: string) =>
  db.prepare("UPDATE users SET requests_used = requests_used + 1 WHERE id = ?").run(userId);

export const quotaFor = (user: Pick<UserRecord, "plan" | "requests_used">) => {
  const pro = user.plan === "pro";
  return {
    plan: pro ? "pro" : "free",
    requestsUsed: user.requests_used,
    requestsLimit: pro ? null : FREE_REQUEST_LIMIT,
    remaining: pro ? null : Math.max(0, FREE_REQUEST_LIMIT - user.requests_used),
  };
};

export const hasFreeQuota = (user: Pick<UserRecord, "plan" | "requests_used">) =>
  user.plan === "pro" || user.requests_used < FREE_REQUEST_LIMIT;
