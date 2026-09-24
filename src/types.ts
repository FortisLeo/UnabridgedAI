import type { Request } from "express";

export type AuthedRequest = Request & { userId: string };
export const userIdOf = (req: Request) => (req as AuthedRequest).userId;

export type ChatRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type MessageRow = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  sources: string | null;
  created_at: number;
};

export type SettingsRow = {
  user_id: string;
  memory_enabled: number;
  memory: string;
  custom_instructions: string;
  web_search: number;
  dark_web_search: number;
  temporary_chat: number;
  save_history: number;
  model: string;
  theme: string;
};

export type PublicSettings = {
  memoryEnabled: boolean;
  memory: string;
  customInstructions: string;
  webSearch: boolean;
  darkWebSearch: boolean;
  temporaryChat: boolean;
  saveHistory: boolean;
  model: string;
  theme: string;
};

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  kind: "web" | "darkweb";
};
