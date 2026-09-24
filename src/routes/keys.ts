import { Router } from "express";
import { issueApiKey, revokeActiveApiKeys } from "../repositories/api-keys.ts";
import { userIdOf } from "../types.ts";

export const keysRouter = Router();

keysRouter.post("/rotate", (req, res) => {
  const userId = userIdOf(req);
  revokeActiveApiKeys(userId);
  res.json({ apiKey: issueApiKey(userId) });
});
