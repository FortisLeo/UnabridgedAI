import { Router } from "express";
import { getUserUsage, quotaFor } from "../repositories/usage.ts";
import { userIdOf } from "../types.ts";
import { auth } from "../middleware/auth.ts";

export const billingRouter = Router();

billingRouter.get("/", auth, (req, res) => {
  const user = getUserUsage(userIdOf(req));
  if (!user) return res.status(401).json({ error: "Sign in required" });
  res.json({ quota: quotaFor(user) });
});
