import { Router } from "express";
import { z } from "zod";
import { paramId } from "../lib/http.ts";
import { deleteChat, listChats, listMessages, ownedChat, updateChat } from "../repositories/chats.ts";
import { userIdOf } from "../types.ts";

export const chatsRouter = Router();

chatsRouter.get("/", (req, res) => {
  res.json({ chats: listChats(userIdOf(req)) });
});

chatsRouter.get("/:id", (req, res) => {
  const chat = ownedChat(userIdOf(req), paramId(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json({
    chat,
    messages: listMessages(chat.id).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: message.sources ? JSON.parse(message.sources) : [],
      createdAt: message.created_at,
    })),
  });
});

chatsRouter.patch("/:id", (req, res) => {
  const parsed = z.object({ title: z.string().trim().min(1).max(80).optional(), archived: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const chat = ownedChat(userIdOf(req), paramId(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  updateChat(chat.id, parsed.data.title ?? chat.title, Number(parsed.data.archived ?? false), Date.now());
  res.json({ ok: true });
});

chatsRouter.delete("/:id", (req, res) => {
  const chat = ownedChat(userIdOf(req), paramId(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  deleteChat(chat.id);
  res.json({ ok: true });
});
