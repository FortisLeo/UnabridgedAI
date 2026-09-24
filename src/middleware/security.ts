import type { NextFunction, Request, Response } from "express";
import { clientIp, isPrivateIp } from "../lib/ip.ts";
import { AUTO_BLACKLIST_SIGNUPS, CHAT_RATE, SIGNIN_RATE, SIGNUP_RATE, WEEK_MS } from "../lib/quota.ts";
import { blacklistIp, countIpEvents, isIpBlacklisted, pruneIpEvents, recordIpEvent } from "../repositories/ip.ts";

pruneIpEvents(Date.now() - WEEK_MS);

const limit = (action: string, windowMs: number, max: number, message: string) =>
  (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    if (isIpBlacklisted(ip)) return res.status(403).json({ error: "This network is blocked." });
    const count = countIpEvents(ip, action, Date.now() - windowMs);
    if (count >= max) {
      if (action === "signup" && !isPrivateIp(ip) && countIpEvents(ip, "signup", Date.now() - WEEK_MS) >= AUTO_BLACKLIST_SIGNUPS) {
        blacklistIp(ip, "too many signups");
        return res.status(403).json({ error: "This network is blocked." });
      }
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    recordIpEvent(ip, action);
    next();
  };

export const blockBlacklistedIp = (req: Request, res: Response, next: NextFunction) => {
  const ip = clientIp(req);
  if (isIpBlacklisted(ip)) return res.status(403).json({ error: "This network is blocked." });
  next();
};

export const signupGuard = limit("signup", SIGNUP_RATE.windowMs, SIGNUP_RATE.max, "Too many accounts from this network. Try later.");
export const signinGuard = limit("signin", SIGNIN_RATE.windowMs, SIGNIN_RATE.max, "Too many sign-in attempts. Try later.");
export const chatGuard = limit("chat", CHAT_RATE.windowMs, CHAT_RATE.max, "Slow down. Too many messages from this network.");
