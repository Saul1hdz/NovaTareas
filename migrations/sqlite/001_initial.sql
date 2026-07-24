CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  telefono TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'comun'
    CHECK (user_type IN ('estudiante', 'empleado', 'comun')),
  avatar_url TEXT,
  telegram_chat_id TEXT UNIQUE,
  theme TEXT NOT NULL DEFAULT 'dark'
    CHECK (theme IN ('light', 'dark')),
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expiry TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE security_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE
    REFERENCES users(id) ON DELETE CASCADE,
  q1_index INTEGER NOT NULL CHECK (q1_index BETWEEN 0 AND 9),
  q1_answer TEXT NOT NULL,
  q2_index INTEGER NOT NULL CHECK (q2_index BETWEEN 0 AND 9),
  q2_answer TEXT NOT NULL,
  recovery_attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  CHECK (q1_index <> q2_index)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER
    REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'media'
    CHECK (priority IN ('baja', 'media', 'alta', 'urgente')),
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'en progreso', 'completada')),
  label TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  reminder_at TEXT,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  reminder_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminder_sent IN (0, 1)),
  overdue_notified INTEGER NOT NULL DEFAULT 0 CHECK (overdue_notified IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  observations TEXT,
  what_worked TEXT,
  what_failed TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  archived_at TEXT,
  reopened_at TEXT
);

CREATE TABLE subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL
    REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL
    REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL
    REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  ai_reply TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL UNIQUE
    REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  vector TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_tasks_user_archived ON tasks(user_id, archived);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_user_priority ON tasks(user_id, priority);
CREATE INDEX idx_tasks_user_due_date ON tasks(user_id, due_date);
CREATE INDEX idx_tasks_reminder_at ON tasks(reminder_at, reminder_sent);
CREATE INDEX idx_subtasks_task_id ON subtasks(task_id);
CREATE INDEX idx_task_history_task_id ON task_history(task_id);
CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_task_embeddings_user_id ON task_embeddings(user_id);
