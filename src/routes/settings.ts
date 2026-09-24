import { Router } from "express";
import { z } from "zod";
import { getSettings, publicSettings, updateSettings } from "../repositories/settings.ts";
import { userIdOf } from "../types.ts";

export const settingsRouter = Router();

settingsRouter.get("/", (req, res) => {
  res.json({ settings: publicSettings(getSettings(userIdOf(req))) });
});

settingsRouter.put("/", (req, res) => {
  const parsed = z
    .object({
      memoryEnabled: z.boolean().optional(),
      memory: z.string().max(4000).optional(),
      customInstructions: z.string().max(4000).optional(),
      webSearch: z.boolean().optional(),
      darkWebSearch: z.boolean().optional(),
      temporaryChat: z.boolean().optional(),
      saveHistory: z.boolean().optional(),
      model: z.string().min(1).max(80).optional(),
      theme: z.enum(["dark", "light"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid settings" });
  const userId = userIdOf(req);
  const current = getSettings(userId);
  updateSettings(userId, {
    memory_enabled: Number(parsed.data.memoryEnabled ?? current.memory_enabled),
    memory: parsed.data.memory ?? current.memory,
    custom_instructions: parsed.data.customInstructions ?? current.custom_instructions,
    web_search: Number(parsed.data.webSearch ?? current.web_search),
    dark_web_search: Number(parsed.data.darkWebSearch ?? current.dark_web_search),
    temporary_chat: Number(parsed.data.temporaryChat ?? current.temporary_chat),
    save_history: Number(parsed.data.saveHistory ?? current.save_history),
    model: parsed.data.model ?? current.model,
    theme: parsed.data.theme ?? current.theme,
  });
  res.json({ settings: publicSettings(getSettings(userId)) });
});
