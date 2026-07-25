import Database from 'better-sqlite3';
import path from 'node:path';

export const IMPORT_TABLES = [
  {
    name: 'users',
    columns: [
      'id', 'username', 'full_name', 'email', 'password_hash', 'telefono',
      'user_type', 'avatar_url', 'telegram_chat_id', 'theme',
      'google_access_token', 'google_refresh_token', 'google_token_expiry',
      'session_version', 'created_at', 'updated_at',
    ],
  },
  {
    name: 'security_questions',
    columns: [
      'id', 'user_id', 'q1_index', 'q1_answer', 'q2_index', 'q2_answer',
      'recovery_attempts', 'last_attempt_at',
    ],
  },
  {
    name: 'categories',
    columns: ['id', 'user_id', 'name', 'color', 'created_at'],
  },
  {
    name: 'tasks',
    columns: [
      'id', 'user_id', 'category_id', 'title', 'description', 'priority',
      'status', 'label', 'due_date', 'reminder_at', 'completed',
      'reminder_sent', 'overdue_notified', 'archived', 'observations',
      'what_worked', 'what_failed', 'created_at', 'completed_at',
      'archived_at', 'reopened_at', 'updated_at',
    ],
  },
  {
    name: 'subtasks',
    columns: ['id', 'task_id', 'text', 'done', 'created_at'],
  },
  {
    name: 'task_history',
    columns: [
      'id', 'task_id', 'user_id', 'field', 'old_value', 'new_value',
      'changed_at',
    ],
  },
  {
    name: 'task_comments',
    columns: [
      'id', 'task_id', 'user_id', 'body', 'ai_reply', 'created_at',
    ],
  },
  {
    name: 'task_embeddings',
    columns: [
      'id', 'task_id', 'user_id', 'vector', 'model', 'dimension',
      'created_at', 'updated_at',
    ],
  },
  {
    name: 'telegram_link_codes',
    columns: [
      'id', 'user_id', 'code_hash', 'expires_at', 'used_at', 'created_at',
    ],
  },
];

const SOURCE_TABLES = [
  ...IMPORT_TABLES.map(({ name }) => name),
  'schema_migrations',
];

function asBoolean(value) {
  return value === true || value === 1 || value === '1';
}

function encryptedTokenOrNull(value) {
  if (value == null || value === '') return null;
  return String(value).startsWith('enc:v1:') ? String(value) : null;
}

export function toPostgresTimestamp(value, numericUnit = 'auto') {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Timestamp inválido.');
    return value;
  }

  const numeric = typeof value === 'number'
    ? value
    : (/^-?\d+(?:\.\d+)?$/.test(String(value).trim())
      ? Number(value)
      : null);

  let parsed;
  if (numeric != null && Number.isFinite(numeric)) {
    const multiplier = numericUnit === 'seconds'
      ? 1_000
      : numericUnit === 'milliseconds'
        ? 1
        : Math.abs(numeric) >= 1_000_000_000_000 ? 1 : 1_000;
    parsed = new Date(numeric * multiplier);
  } else {
    const text = String(value).trim();
    const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/
      .test(text);
    parsed = new Date(sqliteUtc ? `${text.replace(' ', 'T')}Z` : text);
  }

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Timestamp SQLite inválido: ${String(value).slice(0, 40)}`);
  }
  return parsed;
}

export function toPostgresParameter(table, column, value) {
  if (table === 'task_embeddings' && column === 'vector' && value != null) {
    return JSON.stringify(value);
  }
  return value ?? null;
}

function dueDateOrNull(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Fecha límite inválida: ${String(value).slice(0, 20)}`);
  }
  return normalized;
}

function parseEmbeddingVector(value) {
  const vector = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(vector) || vector.some((item) => !Number.isFinite(item))) {
    throw new Error('Vector de embedding inválido.');
  }
  return vector;
}

function maxTimestamp(...values) {
  const dates = values.filter(Boolean).map((value) => toPostgresTimestamp(value));
  if (dates.length === 0) return new Date(0);
  return new Date(Math.max(...dates.map((value) => value.getTime())));
}

export function transformSqliteSnapshot(snapshot) {
  const warnings = {
    discardedPlaintextGoogleAccessTokens: 0,
    discardedPlaintextGoogleRefreshTokens: 0,
  };

  const users = snapshot.users.map((row) => {
    const accessToken = encryptedTokenOrNull(row.google_access_token);
    const refreshToken = encryptedTokenOrNull(row.google_refresh_token);
    if (row.google_access_token && !accessToken) {
      warnings.discardedPlaintextGoogleAccessTokens += 1;
    }
    if (row.google_refresh_token && !refreshToken) {
      warnings.discardedPlaintextGoogleRefreshTokens += 1;
    }
    const createdAt = toPostgresTimestamp(row.created_at);
    return {
      ...row,
      google_access_token: accessToken,
      google_refresh_token: refreshToken,
      google_token_expiry: toPostgresTimestamp(row.google_token_expiry),
      session_version: Number(row.session_version || 0),
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  const tasks = snapshot.tasks.map((row) => {
    const completed = row.status === 'completada';
    const createdAt = toPostgresTimestamp(row.created_at);
    const completedAt = completed
      ? toPostgresTimestamp(row.completed_at || row.created_at)
      : null;
    const archivedAt = toPostgresTimestamp(row.archived_at);
    const reopenedAt = toPostgresTimestamp(row.reopened_at);
    return {
      ...row,
      due_date: dueDateOrNull(row.due_date),
      reminder_at: toPostgresTimestamp(row.reminder_at),
      completed,
      reminder_sent: asBoolean(row.reminder_sent),
      overdue_notified: asBoolean(row.overdue_notified),
      archived: asBoolean(row.archived),
      created_at: createdAt,
      completed_at: completedAt,
      archived_at: archivedAt,
      reopened_at: reopenedAt,
      updated_at: maxTimestamp(
        createdAt,
        completedAt,
        archivedAt,
        reopenedAt,
      ),
    };
  });

  const transformed = {
    users,
    security_questions: snapshot.security_questions.map((row) => ({
      ...row,
      recovery_attempts: Number(row.recovery_attempts || 0),
      last_attempt_at: toPostgresTimestamp(row.last_attempt_at, 'milliseconds'),
    })),
    categories: snapshot.categories.map((row) => ({
      ...row,
      created_at: toPostgresTimestamp(row.created_at),
    })),
    tasks,
    subtasks: snapshot.subtasks.map((row) => ({
      ...row,
      done: asBoolean(row.done),
      created_at: toPostgresTimestamp(row.created_at),
    })),
    task_history: snapshot.task_history.map((row) => ({
      ...row,
      changed_at: toPostgresTimestamp(row.changed_at),
    })),
    task_comments: snapshot.task_comments.map((row) => ({
      ...row,
      created_at: toPostgresTimestamp(row.created_at),
    })),
    task_embeddings: snapshot.task_embeddings.map((row) => {
      const vector = parseEmbeddingVector(row.vector);
      return {
        ...row,
        vector,
        dimension: vector.length,
        created_at: toPostgresTimestamp(row.created_at, 'seconds'),
        updated_at: toPostgresTimestamp(row.updated_at, 'seconds'),
      };
    }),
    telegram_link_codes: snapshot.telegram_link_codes.map((row) => ({
      ...row,
      expires_at: toPostgresTimestamp(row.expires_at, 'seconds'),
      used_at: toPostgresTimestamp(row.used_at, 'seconds'),
      created_at: toPostgresTimestamp(row.created_at, 'seconds'),
    })),
  };

  return { tables: transformed, warnings };
}

export function readSqliteSnapshot(sourcePath) {
  const absolutePath = path.resolve(sourcePath);
  const database = new Database(absolutePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`La integridad SQLite falló: ${integrity}`);
    }

    const available = new Set(database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all().map(({ name }) => name));
    const missing = SOURCE_TABLES.filter((name) => !available.has(name));
    if (missing.length > 0) {
      throw new Error(`Faltan tablas SQLite: ${missing.join(', ')}`);
    }

    const snapshot = Object.fromEntries(SOURCE_TABLES.map((name) => [
      name,
      database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]));
    return {
      sourcePath: absolutePath,
      integrity,
      snapshot,
    };
  } finally {
    database.close();
  }
}
