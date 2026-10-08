import { Router } from "express";
import { listApiKeys } from "../repositories/api-keys.ts";
import { getSettings, publicSettings } from "../repositories/settings.ts";
import { findUserById } from "../repositories/users.ts";
import { quotaFor } from "../repositories/usage.ts";
import { userIdOf } from "../types.ts";

export const meRouter = Router();

meRouter.get("/", (req, res) => {
  const userId = userIdOf(req);
  const user = findUserById(userId);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  const quota = quotaFor(user);
  res.json({
    user: { id: user.id, username: user.username, plan: quota.plan, pro_expires_at: user.pro_expires_at, created_at: user.created_at },
    quota,
    keys: listApiKeys(userId).map(({ prefix, created_at, revoked_at }) => ({ prefix, created_at, revoked_at })),
    settings: publicSettings(getSettings(userId)),
  });
});
