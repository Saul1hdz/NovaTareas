CREATE TABLE telegram_link_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_telegram_link_codes_user
  ON telegram_link_codes(user_id, expires_at);
CREATE INDEX idx_telegram_link_codes_expiry
  ON telegram_link_codes(expires_at, used_at);
