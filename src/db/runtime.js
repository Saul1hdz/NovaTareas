import pg from 'pg';

// PostgreSQL devuelve BIGINT (por ejemplo COUNT(*)) como string por defecto.
// Los consumidores actuales esperan números, igual que con SQLite.
pg.types.setTypeParser(20, Number);

const BOOLEAN_COLUMNS = new Set([
  'archived',
  'completed',
  'done',
  'overdue_notified',
  'reminder_sent',
]);

const TIMESTAMP_COLUMNS = new Set([
  'archived_at',
  'changed_at',
  'completed_at',
  'created_at',
  'expires_at',
  'google_token_expiry',
  'last_attempt_at',
  'reminder_at',
  'reopened_at',
  'updated_at',
  'used_at',
]);

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function cleanColumnName(value) {
  return String(value || '')
    .replaceAll('"', '')
    .split('.')
    .at(-1)
    ?.trim()
    .toLowerCase();
}

function inferParameterColumns(sql) {
  const questionPositions = [];
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] === '?') questionPositions.push(index);
  }
  const columns = Array(questionPositions.length).fill(null);

  const insert = sql.match(
    /insert\s+into\s+[\w"]+\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/is,
  );
  if (insert) {
    const insertColumns = insert[1].split(',').map(cleanColumnName);
    const values = insert[2].split(',');
    let parameterIndex = 0;
    values.forEach((value, valueIndex) => {
      const matches = value.match(/\?/g) || [];
      matches.forEach(() => {
        columns[parameterIndex] = insertColumns[valueIndex] || null;
        parameterIndex += 1;
      });
    });
  }

  questionPositions.forEach((position, parameterIndex) => {
    if (columns[parameterIndex]) return;
    const before = sql.slice(Math.max(0, position - 100), position);
    const direct = before.match(
      /([a-z_][a-z0-9_."]*)\s*(?:=|<>|!=|<=|>=|<|>)\s*$/i,
    );
    if (direct) columns[parameterIndex] = cleanColumnName(direct[1]);
  });

  return columns;
}

function toTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  const numeric = typeof value === 'number'
    ? value
    : (/^-?\d+(?:\.\d+)?$/.test(String(value).trim())
      ? Number(value)
      : null);
  if (numeric != null && Number.isFinite(numeric)) {
    return new Date(
      Math.abs(numeric) >= 1_000_000_000_000 ? numeric : numeric * 1_000,
    );
  }
  const text = String(value).trim();
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/
    .test(text);
  const date = new Date(sqliteUtc ? `${text.replace(' ', 'T')}Z` : text);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Timestamp inválido para PostgreSQL: ${text}`);
  }
  return date;
}

function normalizeSql(sql) {
  return sql
    .replace(
      /\b(archived|completed|done|overdue_notified|reminder_sent)\s*=\s*0\b/gi,
      '$1 = FALSE',
    )
    .replace(
      /\b(archived|completed|done|overdue_notified|reminder_sent)\s*=\s*1\b/gi,
      '$1 = TRUE',
    )
    .replace(/\bunixepoch\(\)/gi, 'CURRENT_TIMESTAMP');
}

function normalizeQuery(sql, params) {
  const columns = inferParameterColumns(sql);
  const normalizedParams = params.map((value, index) => {
    const column = columns[index];
    if (BOOLEAN_COLUMNS.has(column)) {
      return value === true || value === 1 || value === '1';
    }
    if (TIMESTAMP_COLUMNS.has(column)) return toTimestamp(value);
    if (column === 'vector' && Array.isArray(value)) return JSON.stringify(value);
    return value;
  });

  let parameterIndex = 0;
  const text = normalizeSql(sql).replace(/\?/g, () => {
    parameterIndex += 1;
    return `$${parameterIndex}`;
  });
  return { text, values: normalizedParams };
}

class PostgresCompatDatabase {
  constructor(pool, client = null) {
    this.pool = pool;
    this.client = client;
  }

  async query(sql, params = []) {
    const target = this.client || this.pool;
    return target.query(normalizeQuery(sql, params));
  }

  prepare(sql) {
    return {
      get: async (...params) => {
        const result = await this.query(sql, params);
        return result.rows[0];
      },
      all: async (...params) => {
        const result = await this.query(sql, params);
        return result.rows;
      },
      run: async (...params) => {
        const trimmed = sql.trim();
        const isInsert = /^insert\s+/i.test(trimmed);
        const statement = isInsert && !/\breturning\b/i.test(trimmed)
          ? `${trimmed.replace(/;$/, '')} RETURNING id`
          : trimmed;
        const result = await this.query(statement, params);
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows[0]?.id ?? null,
        };
      },
    };
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(new PostgresCompatDatabase(this.pool, client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (!this.client) await this.pool.end();
  }
}

export function createPostgresCompatDatabase(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_URL es obligatoria cuando DATABASE_ENGINE=postgres.');
  }
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (error) => {
    // Evita que la aplicación termine si PostgreSQL reinicia mientras una
    // conexión ociosa sigue en el pool. La siguiente consulta reconectará.
    console.error('[postgres] Conexión ociosa cerrada:', error?.code || error?.name || 'error');
  });
  return new PostgresCompatDatabase(pool);
}

export function safeIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error('Identificador SQL inválido.');
  }
  return quoteIdentifier(identifier);
}
