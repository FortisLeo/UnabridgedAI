export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  requests_used INTEGER NOT NULL DEFAULT 0,
  signup_ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  name TEXT NOT NULL DEFAULT 'default'
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ip_blacklist (
  ip TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ip_events (
  ip TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ip_events_lookup ON ip_events (ip, action, created_at);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  memory_enabled INTEGER NOT NULL DEFAULT 1,
  memory TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
  web_search INTEGER NOT NULL DEFAULT 0,
  dark_web_search INTEGER NOT NULL DEFAULT 0,
  temporary_chat INTEGER NOT NULL DEFAULT 0,
  save_history INTEGER NOT NULL DEFAULT 1,
  model TEXT NOT NULL DEFAULT 'grok-4.5',
  theme TEXT NOT NULL DEFAULT 'dark'
);
`;
