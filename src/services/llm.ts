import { publicError } from "../lib/errors.ts";
import { providerKeys } from "../lib/env.ts";
import type { SearchHit, SettingsRow } from "../types.ts";
import { buildSystemPrompt } from "./prompt.ts";

const deltaText = (payload: unknown) => {
  const choice = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) return choice.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("");
  return "";
};

const openStream = async (providerKey: string, body: Record<string, unknown>, signal: AbortSignal) =>
  fetch("https://api.0-0.pro/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${providerKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export async function* streamChat(
  settings: SettingsRow,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  content: string,
  sources: SearchHit[],
  signal?: AbortSignal,
) {
  const keys = providerKeys();
  if (!keys.length) throw Object.assign(new Error(publicError(503)), { status: 503 });
  const providerKey = keys[Math.floor(Math.random() * keys.length)];
  const base = {
    model: settings.model || "grok-4.5",
    messages: [
      { role: "system", content: buildSystemPrompt(settings, sources) },
      ...history,
      { role: "user", content },
    ],
    stream: true,
  };

  let response = await openStream(providerKey, {
    ...base,
    reasoning_effort: "none",
    reasoning: { effort: "none" },
    enable_thinking: false,
  }, signal ?? AbortSignal.timeout(120000));
  if (!response.ok) {
    response = await openStream(providerKey, {
      ...base,
      reasoning_effort: "low",
      reasoning: { effort: "low" },
    }, signal ?? AbortSignal.timeout(120000));
  }
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
