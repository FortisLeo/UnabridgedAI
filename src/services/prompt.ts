import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SearchHit, SettingsRow } from "../types.ts";

const promptPath = join(dirname(fileURLToPath(import.meta.url)), "../../prompts/system.md");

export type ChatMessage = {
  role: string;
  content?: unknown;
  name?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  function_call?: unknown;
};

export const loadSystemPrompt = () => readFileSync(promptPath, "utf8").trim();

export const buildSystemPrompt = (settings: SettingsRow, sources: SearchHit[]) => {
  const parts = [loadSystemPrompt()];
  if (settings.custom_instructions.trim()) parts.push(`Custom instructions from the user:\n${settings.custom_instructions.trim()}`);
  if (settings.memory_enabled && settings.memory.trim()) parts.push(`Persistent memory about this user:\n${settings.memory.trim()}`);
  if (sources.length) {
    parts.push(
      "Fresh search context. Prefer these facts over older training data and cite links when useful:\n" +
        sources.map((hit) => `[${hit.kind}] ${hit.title}\n${hit.url}\n${hit.snippet}`).join("\n\n"),
    );
  }
  return parts.join("\n\n");
};

export const withSystemPrompt = (messages: ChatMessage[], settings?: SettingsRow | null) => {
  const prefix: ChatMessage[] = [{ role: "system", content: loadSystemPrompt() }];
  if (settings?.custom_instructions.trim()) prefix.push({ role: "system", content: `Custom instructions from the user:\n${settings.custom_instructions.trim()}` });
  if (settings?.memory_enabled && settings.memory.trim()) prefix.push({ role: "system", content: `Persistent memory about this user:\n${settings.memory.trim()}` });
  return [...prefix, ...messages];
};
