import { Router } from "express";
import { z } from "zod";
import { hash, passwordHash, passwordOk, randomUUID } from "../lib/crypto.ts";
import { clientIp, isPrivateIp } from "../lib/ip.ts";
import { SIGNUPS_PER_IP_WEEK, WEEK_MS } from "../lib/quota.ts";
import { blacklistIp, isIpBlacklisted } from "../repositories/ip.ts";
import { deleteSession } from "../repositories/sessions.ts";
import { countSignupsFromIp, findUserByUsername, insertUser } from "../repositories/users.ts";
import { sessionCookie, signIn } from "../services/auth.ts";
import { signinGuard, signupGuard } from "../middleware/security.ts";

export const authRouter = Router();

const clearSessionCookies = (req: import("express").Request, res: import("express").Response) => {
  const options = { ...sessionCookie(req), maxAge: 0 };
  res.clearCookie("unabridged_session", options);
  res.clearCookie("n4n1_session", options);
};

authRouter.post("/signup", signupGuard, (req, res) => {
  const parsed = z
    .object({ username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/), password: z.string().min(10).max(128) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Use a username and a password of at least 10 characters." });
  const ip = clientIp(req);
  if (!isPrivateIp(ip)) {
    if (isIpBlacklisted(ip)) return res.status(403).json({ error: "This network is blocked." });
    if (countSignupsFromIp(ip, Date.now() - WEEK_MS) >= SIGNUPS_PER_IP_WEEK) {
      blacklistIp(ip, "signup farming");
      return res.status(429).json({ error: "Too many accounts from this network this week." });
    }
  }
  const id = randomUUID();
  try {
    insertUser(id, parsed.data.username, passwordHash(parsed.data.password), Date.now(), ip);
    return signIn(res, id, parsed.data.username, req);
  } catch {
    return res.status(409).json({ error: "That username is already taken." });
  }
});

authRouter.post("/signin", signinGuard, (req, res) => {
  const parsed = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials" });
  const row = findUserByUsername(parsed.data.username);
  if (!row || !passwordOk(parsed.data.password, row.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
  return signIn(res, row.id, row.username, req);
});

authRouter.post("/signout", (req, res) => {
  const sid = req.cookies.unabridged_session ?? req.cookies.n4n1_session;
  if (sid) deleteSession(hash(sid));
  clearSessionCookies(req, res);
  res.json({ ok: true });
});
