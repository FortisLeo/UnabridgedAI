import { db } from "../db/client.ts";
import type { PublicSettings, SettingsRow } from "../types.ts";

const defaultSettings = (userId: string): SettingsRow => ({
  user_id: userId,
  memory_enabled: 1,
  memory: "",
  custom_instructions: "",
  web_search: 0,
  dark_web_search: 0,
  temporary_chat: 0,
  save_history: 1,
  model: "grok-4.5",
  theme: "dark",
});

export const publicSettings = (row: SettingsRow): PublicSettings => ({
  memoryEnabled: Boolean(row.memory_enabled),
  memory: row.memory,
  customInstructions: row.custom_instructions,
  webSearch: Boolean(row.web_search),
  darkWebSearch: Boolean(row.dark_web_search),
  temporaryChat: Boolean(row.temporary_chat),
  saveHistory: Boolean(row.save_history),
  model: row.model,
  theme: row.theme,
});

export const getSettings = (userId: string) => {
  const row = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId) as SettingsRow | undefined;
  if (row) return row;
  const created = defaultSettings(userId);
  db.prepare("INSERT INTO settings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    created.user_id,
    created.memory_enabled,
    created.memory,
    created.custom_instructions,
    created.web_search,
    created.dark_web_search,
    created.temporary_chat,
    created.save_history,
    created.model,
    created.theme,
  );
  return created;
};

export const updateSettings = (userId: string, next: Omit<SettingsRow, "user_id">) => {
  db.prepare(
    `UPDATE settings SET memory_enabled=?, memory=?, custom_instructions=?, web_search=?, dark_web_search=?, temporary_chat=?, save_history=?, model=?, theme=? WHERE user_id=?`,
  ).run(
    next.memory_enabled,
    next.memory,
    next.custom_instructions,
    next.web_search,
    next.dark_web_search,
    next.temporary_chat,
    next.save_history,
    next.model,
    next.theme,
    userId,
  );
};
