import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "../lib/crypto.ts";
import { publicError } from "../lib/errors.ts";
import { inputTokenCount } from "../lib/token-count.ts";
import { proActive } from "../lib/subscription.ts";
import { titleFrom } from "../lib/http.ts";
import { chatGuard } from "../middleware/security.ts";
import { listHistory, ownedChat, persistTurn } from "../repositories/chats.ts";
import { getSettings } from "../repositories/settings.ts";
import { claimRequest, getUserUsage, quotaFor, releaseRequest } from "../repositories/usage.ts";
import { streamChat } from "../services/llm.ts";
import { collectSources } from "../services/search.ts";
import { userIdOf } from "../types.ts";

export const chatRouter = Router();

const paywall = (userId: string) => ({
  error: "Free limit reached. Upgrade to Pro to keep chatting.",
  code: "PAYWALL",
  quota: quotaFor(getUserUsage(userId)!),
});

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

  const tokenCount = inputTokenCount(parsed.data.content);
  const freeRequestsActive = !proActive(user.plan, user.pro_expires_at) && user.requests_used < 3;
  if (freeRequestsActive && tokenCount > 500) {
    return res.status(400).json({
      error: `Your first 3 messages are limited to 500 input tokens. This message is ${tokenCount} tokens.`,
      code: "INPUT_TOKEN_LIMIT",
      tokenCount,
      tokenLimit: 500,
    });
  }

  const settings = getSettings(userId);
  const persist = Boolean(settings.save_history) && !settings.temporary_chat;
  const requestedId = parsed.data.chatId ?? null;
  if (persist && requestedId && !ownedChat(userId, requestedId)) {
    return res.status(404).json({ error: "Chat not found" });
  }

  // Claim before the provider call so concurrent sends cannot all pass a stale read.
  if (!claimRequest(userId)) return res.status(402).json(paywall(userId));

  const history = persist && requestedId ? listHistory(requestedId) : [];
  let sources: Awaited<ReturnType<typeof collectSources>> = [];
  try {
    sources = await collectSources(parsed.data.content, Boolean(parsed.data.webSearch), Boolean(parsed.data.darkWebSearch));
  } catch {
    releaseRequest(userId);
    return res.status(502).json({ error: publicError(502) });
  }

  // Open the provider before SSE headers so a rejection is a real HTTP error, not 200 + event: error.
  const iterator = streamChat(settings, history, parsed.data.content, sources);
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
    let prefix = "";
    while (!first.done && !first.value.trim()) {
      prefix += first.value;
      first = await iterator.next();
    }
    if (first.done) throw Object.assign(new Error(publicError(502)), { status: 502 });
    first.value = prefix + first.value;
  } catch (error) {
    releaseRequest(userId);
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 502;
    const code = status >= 400 && status < 600 ? status : 502;
    return res.status(code).json({ error: error instanceof Error ? error.message : publicError(code) });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let reply = "";
  try {
    if (sources.length) send("sources", { sources });
    if (!first.done && first.value) {
      reply += first.value;
      send("delta", { text: first.value });
    }
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      if (!next.value) continue;
      reply += next.value;
      send("delta", { text: next.value });
    }
    if (!reply.trim()) throw Object.assign(new Error(publicError(502)), { status: 502 });

    const chatId = persist ? (requestedId ?? randomUUID()) : null;
    const now = Date.now();
    if (persist && chatId) {
      persistTurn(
        chatId,
        userId,
        titleFrom(parsed.data.content),
        parsed.data.content,
        reply,
        JSON.stringify(sources),
        now,
        randomUUID(),
        randomUUID(),
      );
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
    releaseRequest(userId);
    if (res.writableEnded) return;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 502;
    send("error", { error: error instanceof Error ? error.message : publicError(status) });
    res.end();
  }
});
