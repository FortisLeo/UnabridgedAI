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
  let response: Response | undefined;
  for (const payload of attempts) {
    if (abort.aborted) break;
    try {
      response = await providerFetch("/chat/completions", { method: "POST", signal: abort, body: JSON.stringify(payload) });
      if (response.ok) return response;
    } catch (error) {
      if (abort.aborted) throw error;
      response = undefined;
    }
  }
  if (!response) throw Object.assign(new Error(publicError(502)), { status: 502 });
  return response;
};

export const readErrorBody = async (response: Response) => {
  const raw = scrubModelNames(scrub(await response.text()));
  try {
    return maskModelField(JSON.parse(raw));
  } catch {
    return { error: { message: publicError(response.status), type: "api_error", code: null } };
  }
};

export const pipeCompletionStream = async (upstream: Response, res: { write: (chunk: string) => unknown; end: () => void }) => {
  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (lines.length) res.write(rewriteSse(lines.join("\n") + "\n"));
    }
    if (buffer) res.write(rewriteSse(buffer));
  } catch {
    // client or upstream closed
  }
  res.end();
};

async function* readContentStream(response: Response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const piece = deltaText(JSON.parse(data));
        if (piece) yield piece;
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }
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
    response = await completeChat({ stream: true, messages }, signal);
  }
  if (!response.ok || !response.body) throw Object.assign(new Error(publicError(response.status)), { status: 502 });

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
