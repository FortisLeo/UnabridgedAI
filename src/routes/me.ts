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
  res.json({
    user: { id: user.id, username: user.username, plan: user.plan, created_at: user.created_at },
    quota: quotaFor(user),
    keys: listApiKeys(userId).map(({ prefix, created_at, revoked_at }) => ({ prefix, created_at, revoked_at })),
    settings: publicSettings(getSettings(userId)),
  });
});
