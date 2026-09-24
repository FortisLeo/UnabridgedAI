import { Router } from "express";
import { z } from "zod";
import { countActiveApiKeys, issueApiKey, listApiKeys, renameApiKey, revokeApiKey } from "../repositories/api-keys.ts";
import { userIdOf } from "../types.ts";

export const keysRouter = Router();
const MAX_KEYS = 20;
const nameSchema = z.object({ name: z.string().trim().min(1).max(64).optional() });

keysRouter.get("/", (req, res) => {
  res.json({ keys: listApiKeys(userIdOf(req)) });
});

keysRouter.post("/", (req, res) => {
  const parsed = nameSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Name must be 1–64 characters." });
  const userId = userIdOf(req);
  if (countActiveApiKeys(userId) >= MAX_KEYS) return res.status(400).json({ error: "You already have 20 active keys. Revoke one first." });
  const created = issueApiKey(userId, parsed.data.name ?? "default");
  res.status(201).json({
    key: {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      created_at: created.created_at,
      revoked_at: null,
    },
    secret: created.key,
  });
});

keysRouter.post("/rotate", (req, res) => {
  const parsed = nameSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Name must be 1–64 characters." });
  const userId = userIdOf(req);
  if (countActiveApiKeys(userId) >= MAX_KEYS) return res.status(400).json({ error: "You already have 20 active keys. Revoke one first." });
  const created = issueApiKey(userId, parsed.data.name ?? "default");
  res.json({
    apiKey: created.key,
    key: {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      created_at: created.created_at,
      revoked_at: null,
    },
    secret: created.key,
  });
});

keysRouter.patch("/:id", (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name must be 1–64 characters." });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!renameApiKey(userIdOf(req), id, parsed.data.name)) return res.status(404).json({ error: "Key not found" });
  res.json({ ok: true, name: parsed.data.name });
});

keysRouter.delete("/:id", (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!revokeApiKey(userIdOf(req), id)) return res.status(404).json({ error: "Key not found" });
  res.json({ ok: true });
});
