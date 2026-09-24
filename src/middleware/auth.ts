import type { NextFunction, Request, Response } from "express";
import { hash } from "../lib/crypto.ts";
import { findActiveApiKey } from "../repositories/api-keys.ts";
import { findSessionUser } from "../repositories/sessions.ts";
import type { AuthedRequest } from "../types.ts";

const bearer = (req: Request) => {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
};

export const auth = (req: Request, res: Response, next: NextFunction) => {
  const sid = req.cookies.unabridged_session ?? req.cookies.n4n1_session;
  if (sid) {
    const row = findSessionUser(hash(sid), Date.now());
    if (row) {
      (req as AuthedRequest).userId = row.user_id;
      return next();
    }
  }

  const key = bearer(req);
  if (key.startsWith("UnabridgedAI_") || key.startsWith("n4n1_")) {
    const row = findActiveApiKey(key);
    if (row) {
      (req as AuthedRequest).userId = row.user_id;
      return next();
    }
  }

  return res.status(401).json({ error: "Sign in required" });
};
