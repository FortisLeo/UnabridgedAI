import { Router } from "express";
import { deleteUserChats, listAllChats, listMessages } from "../repositories/chats.ts";
import { getSettings, publicSettings } from "../repositories/settings.ts";
import { userIdOf } from "../types.ts";

export const dataRouter = Router();

dataRouter.get("/export", (req, res) => {
  const userId = userIdOf(req);
  const chats = listAllChats(userId);
  res.json({
    exportedAt: new Date().toISOString(),
    settings: publicSettings(getSettings(userId)),
    chats: chats.map((chat) => ({
      ...chat,
      messages: listMessages(chat.id).map(({ role, content, sources, created_at }) => ({ role, content, sources, created_at })),
    })),
  });
});

dataRouter.delete("/chats", (req, res) => {
  deleteUserChats(userIdOf(req));
  res.json({ ok: true });
});
