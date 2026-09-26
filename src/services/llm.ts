import { publicError, scrub } from "../lib/errors.ts";
import { providerKeys } from "../lib/env.ts";
import { maskModelField, rewriteSse, scrubModelNames, toUpstreamModel } from "../lib/models.ts";
import type { SearchHit, SettingsRow } from "../types.ts";
import { buildSystemPrompt } from "./prompt.ts";

const UPSTREAM = "https://api.0-0.pro/v1";

const asText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).join("");
  if (value && typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string") {
    return (value as { text: string }).text;
  }
  return "";
};

const deltaText = (payload: unknown) => {
  const choice = (payload as { choices?: Array<{ delta?: { content?: unknown; text?: unknown }; message?: { content?: unknown } }> }).choices?.[0];
  return asText(choice?.delta?.content) || asText(choice?.delta?.text) || asText(choice?.message?.content);
};

const pickKey = () => {
  const keys = providerKeys();
  if (!keys.length) throw Object.assign(new Error(publicError(503)), { status: 503 });
  return keys[Math.floor(Math.random() * keys.length)];
};

export const providerFetch = async (path: string, init: RequestInit = {}) => {
  const providerKey = pickKey();
  return fetch(`${UPSTREAM}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${providerKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

const thinkingOff = {
  reasoning_effort: "none",
  reasoning: { effort: "none" },
  enable_thinking: false,
};

const thinkingLow = {
  reasoning_effort: "low",
  reasoning: { effort: "low" },
  enable_thinking: false,
};

export const completeChat = async (body: Record<string, unknown>, signal?: AbortSignal) => {
  const base: Record<string, unknown> = {
    ...thinkingOff,
    ...body,
    model: toUpstreamModel(),
  };
  const abort = signal ?? AbortSignal.timeout(120000);
  const attempts = [base, { ...base, ...thinkingLow }, { ...body, model: toUpstreamModel() }];
  let last: { status: number; body: string } | undefined;
  for (const payload of attempts) {
    if (abort.aborted) break;
    try {
      const next = await providerFetch("/chat/completions", { method: "POST", signal: abort, body: JSON.stringify(payload) });
      if (next.ok) return next;
      last = { status: next.status, body: await next.text() };
      if (next.status === 401 || next.status === 403) break;
    } catch (error) {
      if (abort.aborted) throw error;
    }
  }
  if (!last) throw Object.assign(new Error(publicError(502)), { status: 502 });
  return new Response(last.body, { status: last.status, headers: { "Content-Type": "application/json" } });
};

export const readErrorBody = async (response: Response) => {
  const raw = scrubModelNames(scrub(await response.text()));
  try {
    return maskModelField(JSON.parse(raw));
  } catch {
    return { error: { message: publicError(response.status), type: "api_error", code: null } };
  }
};

/** True when the upstream stream delivered a finish reason or the OpenAI done sentinel. */
export const streamFinished = (raw: string) => raw.split("\\n").some((line) => {
  const data = line.trim().replace(/^data:\s*/, "");
  if (data === "[DONE]") return true;
  try {
    const finish = (JSON.parse(data) as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]?.finish_reason;
    return typeof finish === "string" && finish.length > 0;
  } catch {
    return false;
  }
});

export const pipeCompletionStream = async (upstream: Response, res: { write: (chunk: string) => unknown; end: () => void }) => {
  if (!upstream.body) {
    res.end();
    return "";
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seen = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      seen += text;
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (lines.length) res.write(rewriteSse(lines.join("\n") + "\n"));
    }
    if (buffer) res.write(rewriteSse(buffer));
  } catch {
    // client or upstream closed
  }
  res.end();
  return seen;
};

async function* readContentStream(response: Response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = function* (line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const piece = deltaText(JSON.parse(data));
      if (piece) yield piece;
    } catch {
      // ignore malformed SSE chunks
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) yield* consume(line);
  }
  buffer += decoder.decode();
  if (buffer) yield* consume(buffer);
}

export async function* streamChat(
  settings: SettingsRow,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  content: string,
  sources: SearchHit[],
  signal?: AbortSignal,
) {
  const messages = [
    { role: "system", content: buildSystemPrompt(settings, sources) },
    ...history,
    { role: "user", content },
  ];
  let response = await completeChat({ stream: true, messages }, signal);
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    response = await completeChat({ stream: true, messages }, signal);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error(publicError(response.status)), { status: 502 });
  }

  let yielded = false;
  for await (const piece of readContentStream(response)) {
    yielded = true;
    yield piece;
  }
  if (yielded || signal?.aborted) return;

  const retry = await completeChat({ stream: true, messages }, signal);
  if (!retry.ok || !retry.body) return;
  for await (const piece of readContentStream(retry)) yield piece;
}
