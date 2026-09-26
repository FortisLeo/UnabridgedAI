import { db } from "../db/client.ts";
import type { ChatRow, MessageRow } from "../types.ts";

export const CHAT_LIST_LIMIT = 100;

export const listChats = (userId: string) =>
  db.prepare("SELECT id, title, created_at, updated_at FROM chats WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT ?").all(userId, CHAT_LIST_LIMIT) as ChatRow[];

export const countVisibleChats = (userId: string) =>
  (db.prepare("SELECT COUNT(*) AS count FROM chats WHERE user_id = ? AND archived = 0").get(userId) as { count: number }).count;

export const listAllChats = (userId: string) =>
  db.prepare("SELECT id, title, archived, created_at, updated_at FROM chats WHERE user_id = ?").all(userId) as Array<ChatRow & { archived: number }>;

export const ownedChat = (userId: string, chatId: string) =>
  db.prepare("SELECT * FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId) as (ChatRow & { archived?: number; user_id?: string }) | undefined;

export const createChat = (id: string, userId: string, title: string, now: number) =>
  db.prepare("INSERT INTO chats VALUES (?, ?, ?, 0, ?, ?)").run(id, userId, title, now, now);

export const updateChat = (id: string, patch: { title?: string; archived?: number }, updatedAt: number) =>
  db.prepare("UPDATE chats SET title = COALESCE(?, title), archived = COALESCE(?, archived), updated_at = ? WHERE id = ?").run(
    patch.title ?? null,
    patch.archived ?? null,
    updatedAt,
    id,
  );

export const touchChat = (id: string, updatedAt: number) =>
  db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(updatedAt, id);

export const deleteChat = (id: string) => db.prepare("DELETE FROM chats WHERE id = ?").run(id);

export const deleteUserChats = (userId: string) => db.prepare("DELETE FROM chats WHERE user_id = ?").run(userId);

export const listMessages = (chatId: string) =>
  db.prepare("SELECT id, role, content, sources, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC").all(chatId) as MessageRow[];

export const listHistory = (chatId: string) =>
  db.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC").all(chatId) as Array<{ role: "user" | "assistant"; content: string }>;

export const insertMessage = (id: string, chatId: string, role: string, content: string, sources: string | null, createdAt: number) =>
  db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)").run(id, chatId, role, content, sources, createdAt);

/** Chat row plus both turns, or nothing. A failed generation must not leave a sidebar ghost. */
export const persistTurn = (
  chatId: string,
  userId: string,
  title: string,
  userContent: string,
  assistantContent: string,
  sources: string | null,
  now: number,
  userMessageId: string,
  assistantMessageId: string,
) => {
  const write = db.transaction(() => {
    const existing = ownedChat(userId, chatId);
    if (!existing) createChat(chatId, userId, title, now);
    insertMessage(userMessageId, chatId, "user", userContent, null, now);
    insertMessage(assistantMessageId, chatId, "assistant", assistantContent, sources, now + 1);
    touchChat(chatId, now + 1);
  });
  write();
};
