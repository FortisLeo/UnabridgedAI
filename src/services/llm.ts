import { publicError, scrub } from "../lib/errors.ts";
import { providerKeys } from "../lib/env.ts";
import { maskModelField, rewriteSse, scrubModelNames, toUpstreamModel } from "../lib/models.ts";
import type { SearchHit, SettingsRow } from "../types.ts";
import { buildSystemPrompt } from "./prompt.ts";

const UPSTREAM = "https://api.0-0.pro/v1";

const deltaText = (payload: unknown) => {
  const choice = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) return choice.map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? "")).join("");
  return "";
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

export const completeChat = async (body: Record<string, unknown>, signal?: AbortSignal) => {
  const payload: Record<string, unknown> = {
    reasoning_effort: "none",
    reasoning: { effort: "none" },
    enable_thinking: false,
    ...body,
    model: toUpstreamModel(),
  };
  const abort = signal ?? AbortSignal.timeout(120000);
  let response = await providerFetch("/chat/completions", { method: "POST", signal: abort, body: JSON.stringify(payload) });
  if (!response.ok) {
    response = await providerFetch("/chat/completions", {
      method: "POST",
      signal: abort,
      body: JSON.stringify({ ...payload, reasoning_effort: "low", reasoning: { effort: "low" } }),
    });
  }
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

export async function* streamChat(
  settings: SettingsRow,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  content: string,
  sources: SearchHit[],
  signal?: AbortSignal,
) {
  const response = await completeChat(
    {
      stream: true,
      messages: [
        { role: "system", content: buildSystemPrompt(settings, sources) },
        ...history,
        { role: "user", content },
      ],
    },
    signal,
  );
  if (!response.ok || !response.body) throw Object.assign(new Error(publicError(response.status)), { status: 502 });

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
