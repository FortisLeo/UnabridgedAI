import type { NextFunction, Request, Response } from "express";
import { openaiError } from "../lib/errors.ts";
import { hash } from "../lib/crypto.ts";
import { findActiveApiKey } from "../repositories/api-keys.ts";
import { findSessionUser } from "../repositories/sessions.ts";
import type { AuthedRequest } from "../types.ts";

const bearer = (req: Request) => {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
};

const apiKeyFrom = (req: Request) => bearer(req) || req.get("x-api-key")?.trim() || "";

export const auth = (req: Request, res: Response, next: NextFunction) => {
  const sid = req.cookies.unabridged_session ?? req.cookies.n4n1_session;
  if (sid) {
    const row = findSessionUser(hash(sid), Date.now());
    if (row) {
      (req as AuthedRequest).userId = row.user_id;
      return next();
    }
  }

  const key = apiKeyFrom(req);
  if (key) {
    const row = findActiveApiKey(key);
    if (row) {
      (req as AuthedRequest).userId = row.user_id;
      return next();
    }
  }

  return res.status(401).json({ error: "Sign in required" });
};

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const key = apiKeyFrom(req);
  if (!key) return res.status(401).json(openaiError("Missing API key. Set Authorization: Bearer <key>.", "invalid_request_error", "invalid_api_key"));
  const row = findActiveApiKey(key);
  if (!row) return res.status(401).json(openaiError("Invalid API key.", "invalid_request_error", "invalid_api_key"));
  (req as AuthedRequest).userId = row.user_id;
  next();
};
