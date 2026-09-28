export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  requests_used INTEGER NOT NULL DEFAULT 0,
  signup_ip TEXT,
  created_at INTEGER NOT NULL,
  username_lower TEXT
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
CREATE TABLE IF NOT EXISTS payment_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS address_counters (
  family TEXT PRIMARY KEY,
  next_index INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_addresses (
  address TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  derivation_index INTEGER NOT NULL,
  ata TEXT,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (family, derivation_index)
);
CREATE TABLE IF NOT EXISTS payment_invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  asset TEXT NOT NULL,
  token_contract TEXT,
  expected_base_units TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE REFERENCES payment_addresses(address),
  derivation_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  qr_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  grant_applied_at INTEGER,
  already_pro INTEGER NOT NULL DEFAULT 0,
  refund_address TEXT,
  refund_chain TEXT,
  refund_requested_at INTEGER,
  note TEXT,
  uri TEXT,
  second_read_ok INTEGER NOT NULL DEFAULT 0,
  swept_at INTEGER,
  sweep_tx TEXT
);
CREATE INDEX IF NOT EXISTS payment_invoices_user ON payment_invoices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_invoices_status ON payment_invoices (status, chain);
CREATE TABLE IF NOT EXISTS payment_sweeps (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES payment_invoices(id),
  chain TEXT NOT NULL,
  asset TEXT NOT NULL,
  token_contract TEXT NOT NULL,
  from_address TEXT NOT NULL,
  derivation_index INTEGER NOT NULL,
  to_address TEXT NOT NULL,
  base_units TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  gas_price TEXT NOT NULL,
  gas_limit INTEGER NOT NULL,
  unsigned_tx TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  broadcast_tx TEXT,
  broadcast_at INTEGER
);
CREATE TABLE IF NOT EXISTS payment_credits (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES payment_invoices(id),
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  output_index INTEGER NOT NULL,
  output_pubkey TEXT,
  from_address TEXT,
  base_units TEXT NOT NULL,
  height INTEGER NOT NULL,
  block_hash TEXT,
  confirmations INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  wrong_asset INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  settled_at INTEGER,
  disappeared_at INTEGER,
  confirmed_at INTEGER,
  credit_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS payment_cursors (
  chain TEXT PRIMARY KEY,
  height INTEGER NOT NULL,
  block_hash TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_webhook_endpoints (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES payment_webhook_endpoints(id),
  invoice_id TEXT NOT NULL,
  event TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE TABLE IF NOT EXISTS payment_webhook_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES payment_webhook_deliveries(id),
  at INTEGER NOT NULL,
  status INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT,
  user_id TEXT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_events_user ON payment_events (user_id, kind, at);
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
