import type { CookieOptions, Request, Response } from "express";
import { hash, randomToken } from "../lib/crypto.ts";
import { getSettings } from "../repositories/settings.ts";
import { insertSession } from "../repositories/sessions.ts";
import { getUserUsage, quotaFor } from "../repositories/usage.ts";

const isIpHost = (host: string) => {
  const value = host.replace(/^\[|\]$/g, "").split(":")[0];
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":");
};

const requestHttps = (req?: Request) => Boolean(req?.secure);

export const sessionCookie = (req?: Request): CookieOptions => {
  const host = (req?.hostname ?? "").trim();
  const forced = process.env.COOKIE_SECURE?.trim().toLowerCase();
  const secure = forced === "1" || forced === "true" ? true : forced === "0" || forced === "false" ? false : !isIpHost(host) && requestHttps(req);
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  };
};

export const signIn = (res: Response, id: string, username: string, req?: Request) => {
  const sid = randomToken();
  insertSession(hash(sid), id, Date.now() + 1000 * 60 * 60 * 24 * 30);
  getSettings(id);
  const options = sessionCookie(req);
  res.clearCookie("n4n1_session", { ...options, maxAge: 0 });
  res.cookie("unabridged_session", sid, options);
  const usage = getUserUsage(id);
  return res.json({
    user: { id, username, plan: usage?.plan ?? "free" },
    quota: usage ? quotaFor(usage) : undefined,
  });
};
