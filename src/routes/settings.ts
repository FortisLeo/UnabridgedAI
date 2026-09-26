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
      theme: z.enum(["dark", "light"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid settings" });
  const userId = userIdOf(req);
  const patch = parsed.data;
  updateSettings(userId, {
    ...(patch.memoryEnabled === undefined ? {} : { memory_enabled: Number(patch.memoryEnabled) }),
    ...(patch.memory === undefined ? {} : { memory: patch.memory }),
    ...(patch.customInstructions === undefined ? {} : { custom_instructions: patch.customInstructions }),
    ...(patch.webSearch === undefined ? {} : { web_search: Number(patch.webSearch) }),
    ...(patch.darkWebSearch === undefined ? {} : { dark_web_search: Number(patch.darkWebSearch) }),
    ...(patch.temporaryChat === undefined ? {} : { temporary_chat: Number(patch.temporaryChat) }),
    ...(patch.saveHistory === undefined ? {} : { save_history: Number(patch.saveHistory) }),
    ...(patch.theme === undefined ? {} : { theme: patch.theme }),
  });
  res.json({ settings: publicSettings(getSettings(userId)) });
});
