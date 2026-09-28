import type { NextFunction, Request, Response } from "express";
import { clientIp, isPrivateIp } from "../lib/ip.ts";
import { AUTO_BLACKLIST_SIGNUPS, CHAT_RATE, SIGNIN_RATE, SIGNUP_RATE, WEEK_MS } from "../lib/quota.ts";
import { blacklistIp, countIpEvents, isIpBlacklisted, pruneIpEvents, recordIpEvent } from "../repositories/ip.ts";

pruneIpEvents(Date.now() - WEEK_MS);

const overLimit = (ip: string, action: string, windowMs: number, max: number) =>
  countIpEvents(ip, action, Date.now() - windowMs) >= max;

/** Shared blacklist and rate check. Sign-in records only after the password fails. */
export const guardIp = (req: Request, res: Response, action: string, windowMs: number, max: number, message: string) => {
  const ip = clientIp(req);
  if (isIpBlacklisted(ip)) {
    res.status(403).json({ error: "This network is blocked." });
    return false;
  }
  if (isPrivateIp(ip)) return true;
  if (overLimit(ip, action, windowMs, max)) {
    if (action === "signup" && countIpEvents(ip, "signup", Date.now() - WEEK_MS) >= AUTO_BLACKLIST_SIGNUPS) {
      blacklistIp(ip, "too many signups");
      res.status(403).json({ error: "This network is blocked." });
      return false;
    }
    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    res.status(429).json({ error: message });
    return false;
  }
  return true;
};

const limit = (action: string, windowMs: number, max: number, message: string, record: boolean) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!guardIp(req, res, action, windowMs, max, message)) return;
    if (record && !isPrivateIp(clientIp(req))) recordIpEvent(clientIp(req), action);
    next();
  };

export const blockBlacklistedIp = (req: Request, res: Response, next: NextFunction) => {
  const ip = clientIp(req);
  if (isIpBlacklisted(ip)) return res.status(403).json({ error: "This network is blocked." });
  next();
};

export const signupGuard = limit("signup", SIGNUP_RATE.windowMs, SIGNUP_RATE.max, "Too many accounts from this network. Try later.", true);
export const signinGuard = limit("signin", SIGNIN_RATE.windowMs, SIGNIN_RATE.max, "Too many sign-in attempts. Try later.", false);
export const chatGuard = limit("chat", CHAT_RATE.windowMs, CHAT_RATE.max, "Slow down. Too many messages from this network.", true);

export const recordFailedSignin = (req: Request) => {
  const ip = clientIp(req);
  if (isPrivateIp(ip)) return;
  recordIpEvent(ip, "signin");
};
