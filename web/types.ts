export type View = "chat" | "settings" | "billing";

export type User = {
  id: string;
  username: string;
  plan: string;
};

export type Quota = {
  plan: "free" | "pro";
  requestsUsed: number;
  requestsLimit: number | null;
  remaining: number | null;
};

export type ChatSummary = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type Source = {
  title: string;
  url: string;
  snippet: string;
  kind: "web" | "darkweb";
};

export type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

export type Settings = {
  memoryEnabled: boolean;
  memory: string;
  customInstructions: string;
  webSearch: boolean;
  darkWebSearch: boolean;
  temporaryChat: boolean;
  saveHistory: boolean;
  model: string;
  theme: "dark" | "light";
};

export const defaultSettings: Settings = {
  memoryEnabled: true,
  memory: "",
  customInstructions: "",
  webSearch: false,
  darkWebSearch: false,
  temporaryChat: false,
  saveHistory: true,
  model: "grok-4.5",
  theme: "dark",
};
