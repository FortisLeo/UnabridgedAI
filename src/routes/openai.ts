import { Router } from "express";
import { z } from "zod";
import { openaiError, publicError } from "../lib/errors.ts";
import { isPublicModel, listPublicModels, maskModelField } from "../lib/models.ts";
import { chatGuard } from "../middleware/security.ts";
import { getSettings } from "../repositories/settings.ts";
import { getUserUsage, hasFreeQuota, incrementRequests } from "../repositories/usage.ts";
import { completeChat, pipeCompletionStream, readErrorBody } from "../services/llm.ts";
import { withSystemPrompt, type ChatMessage } from "../services/prompt.ts";
import { userIdOf } from "../types.ts";

export const openaiRouter = Router();

const messageSchema = z.object({
  role: z.string().min(1),
  content: z.unknown().optional(),
  name: z.string().optional(),
  tool_calls: z.unknown().optional(),
  tool_call_id: z.string().optional(),
  function_call: z.unknown().optional(),
}).passthrough();

const completionSchema = z.object({
  model: z.string().min(1).max(120).optional(),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  n: z.number().optional(),
  max_tokens: z.number().optional(),
  max_completion_tokens: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  logit_bias: z.record(z.number()).optional(),
  user: z.string().optional(),
  seed: z.number().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  functions: z.array(z.unknown()).optional(),
  function_call: z.unknown().optional(),
  response_format: z.unknown().optional(),
  logprobs: z.boolean().optional(),
  top_logprobs: z.number().optional(),
  stream_options: z.unknown().optional(),
}).passthrough();

const quotaGate = (userId: string) => {
  const user = getUserUsage(userId);
  if (!user) return { status: 401 as const, body: openaiError("Invalid API key.", "invalid_request_error", "invalid_api_key") };
  if (!hasFreeQuota(user)) {
    return {
      status: 429 as const,
      body: openaiError("Free limit reached. Upgrade to Pro to keep chatting.", "insufficient_quota", "insufficient_quota"),
    };
  }
  return { user };
};

openaiRouter.get("/models", (_req, res) => {
  res.json({ object: "list", data: listPublicModels() });
});

openaiRouter.get("/models/:id", (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const model = listPublicModels().find((item) => item.id === id);
  if (!model) return res.status(404).json(openaiError(`The model '${id}' does not exist`, "invalid_request_error", "model_not_found"));
  res.json(model);
});

openaiRouter.post("/chat/completions", chatGuard, async (req, res) => {
  const parsed = completionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(openaiError("Invalid chat completion request.", "invalid_request_error"));
  if (parsed.data.model && !isPublicModel(parsed.data.model)) {
    return res.status(404).json(openaiError(`The model '${parsed.data.model}' does not exist`, "invalid_request_error", "model_not_found"));
  }

  const userId = userIdOf(req);
  const gate = quotaGate(userId);
  if (!("user" in gate)) return res.status(gate.status).json(gate.body);

  const settings = getSettings(userId);
  const { messages, ...rest } = parsed.data;
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  let upstream: Response;
  try {
    upstream = await completeChat(
      {
        ...rest,
        messages: withSystemPrompt(messages as ChatMessage[], settings),
      },
      abort.signal,
    );
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 502;
    return res.status(status).json(openaiError(error instanceof Error ? error.message : publicError(status), "api_error"));
  }

  if (!upstream.ok) {
    const body = await readErrorBody(upstream);
    return res.status(upstream.status === 401 ? 502 : upstream.status).json(body);
  }

  incrementRequests(userId);

  if (parsed.data.stream) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    await pipeCompletionStream(upstream, res);
    return;
  }

  res.status(200).json(maskModelField(await readErrorBody(upstream)));
});
