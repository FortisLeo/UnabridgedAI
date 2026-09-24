import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "../lib/crypto.ts";
import { publicError } from "../lib/errors.ts";
import { titleFrom } from "../lib/http.ts";
import { createChat, insertMessage, listHistory, ownedChat, touchChat } from "../repositories/chats.ts";
import { getSettings } from "../repositories/settings.ts";
import { getUserUsage, hasFreeQuota, incrementRequests, quotaFor } from "../repositories/usage.ts";
import { streamChat } from "../services/llm.ts";
import { collectSources } from "../services/search.ts";
import { userIdOf } from "../types.ts";
import { chatGuard } from "../middleware/security.ts";

export const chatRouter = Router();

chatRouter.post("/", chatGuard, async (req, res) => {
  const parsed = z
    .object({
      chatId: z.string().uuid().nullish(),
      content: z.string().trim().min(1).max(32000),
      webSearch: z.boolean().optional(),
      darkWebSearch: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid chat request" });

  const userId = userIdOf(req);
  const user = getUserUsage(userId);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  if (!hasFreeQuota(user)) {
    return res.status(402).json({
      error: "Free limit reached. Upgrade to Pro to keep chatting.",
      code: "PAYWALL",
      quota: quotaFor(user),
    });
  }

  const settings = getSettings(userId);
  const persist = Boolean(settings.save_history) && !settings.temporary_chat;
  let chatId = parsed.data.chatId;
  if (persist) {
    if (chatId) {
      if (!ownedChat(userId, chatId)) return res.status(404).json({ error: "Chat not found" });
    } else {
      chatId = randomUUID();
      const now = Date.now();
      createChat(chatId, userId, titleFrom(parsed.data.content), now);
    }
  }

  const history = chatId ? listHistory(chatId) : [];
  const sources = await collectSources(parsed.data.content, Boolean(parsed.data.webSearch), Boolean(parsed.data.darkWebSearch));

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (sources.length) send("sources", { sources });
    let reply = "";
    for await (const chunk of streamChat(settings, history, parsed.data.content, sources)) {
      reply += chunk;
      send("delta", { text: chunk });
    }
    if (!reply.trim()) throw Object.assign(new Error(publicError(502)), { status: 502 });
    incrementRequests(userId);
    const now = Date.now();
    if (persist && chatId) {
      insertMessage(randomUUID(), chatId, "user", parsed.data.content, null, now);
      insertMessage(randomUUID(), chatId, "assistant", reply, JSON.stringify(sources), now + 1);
      touchChat(chatId, now + 1);
    }
    const next = getUserUsage(userId)!;
    send("done", {
      chat: persist && chatId ? ownedChat(userId, chatId) : null,
      sources,
      quota: quotaFor(next),
      reply,
    });
    res.end();
  } catch (error) {
    if (res.writableEnded) return;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 502;
    send("error", { error: error instanceof Error ? error.message : publicError(status) });
    res.end();
  }
});
