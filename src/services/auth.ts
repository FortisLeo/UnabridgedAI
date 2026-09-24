import type { Response } from "express";
import { hash, randomToken } from "../lib/crypto.ts";
import { isProduction } from "../lib/env.ts";
import { issueApiKey, listApiKeys } from "../repositories/api-keys.ts";
import { getSettings } from "../repositories/settings.ts";
import { insertSession } from "../repositories/sessions.ts";
import { getUserUsage, quotaFor } from "../repositories/usage.ts";

export const signIn = (res: Response, id: string, username: string, apiKey?: string) => {
  const sid = randomToken();
  insertSession(hash(sid), id, Date.now() + 1000 * 60 * 60 * 24 * 30);
  getSettings(id);
  const issued = apiKey ?? (listApiKeys(id).some((key) => !key.revoked_at) ? undefined : issueApiKey(id));
  res.cookie("unabridged_session", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  const usage = getUserUsage(id);
  return res.json({
    user: { id, username, plan: usage?.plan ?? "free" },
    apiKey: issued ?? null,
    quota: usage ? quotaFor(usage) : undefined,
  });
};
