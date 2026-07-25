import 'dotenv/config';
import pg from 'pg';
import {
  IMPORT_TABLES,
  readSqliteSnapshot,
  toPostgresParameter,
  transformSqliteSnapshot,
} from '../src/db/migration/sqliteToPostgres.js';

const sourcePath = process.env.SQLITE_MIGRATION_SOURCE?.trim();
const connectionString = process.env.DATABASE_URL?.trim();
const mode = process.env.SQLITE_MIGRATION_MODE?.trim() || 'dry-run';

if (!sourcePath) {
  console.error(
    'SQLITE_MIGRATION_SOURCE debe apuntar explícitamente a una copia SQLite.',
  );
  process.exit(1);
}
if (!connectionString) {
  console.error('DATABASE_URL no está definida.');
  process.exit(1);
}
if (!['dry-run', 'commit'].includes(mode)) {
  console.error('SQLITE_MIGRATION_MODE debe ser dry-run o commit.');
  process.exit(1);
}

const { integrity, snapshot } = readSqliteSnapshot(sourcePath);
const { tables, warnings } = transformSqliteSnapshot(snapshot);
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
});
const client = await pool.connect();

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function assertEmptyDestination() {
  const counts = {};
  for (const { name } of IMPORT_TABLES) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(name)}`,
    );
    counts[name] = result.rows[0].count;
  }
  const recommendations = await client.query(
    'SELECT COUNT(*)::int AS count FROM task_recommendations',
  );
  counts.task_recommendations = recommendations.rows[0].count;

  const occupied = Object.entries(counts)
    .filter(([, count]) => count !== 0)
    .map(([name]) => name);
  if (occupied.length > 0) {
    throw new Error(
      `PostgreSQL no está vacío: ${occupied.join(', ')}. No se importó nada.`,
    );
  }
}

async function insertRows(table, columns, rows) {
  const tableSql = quoteIdentifier(table);
  const columnsSql = columns.map(quoteIdentifier).join(', ');
  for (const row of rows) {
    const values = columns.map((column) => (
      toPostgresParameter(table, column, row[column])
    ));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${tableSql} (${columnsSql})
       OVERRIDING SYSTEM VALUE
       VALUES (${placeholders})`,
      values,
    );
  }
}

async function synchronizeIdentity(table) {
  const tableSql = quoteIdentifier(table);
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('public.${table}', 'id'),
      COALESCE(MAX(id), 1),
      COUNT(*) > 0
    )
    FROM ${tableSql}
  `);
}

async function collectCounts() {
  const counts = {};
  for (const { name } of IMPORT_TABLES) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(name)}`,
    );
    counts[name] = result.rows[0].count;
  }
  return counts;
}

try {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await assertEmptyDestination();

  for (const { name, columns } of IMPORT_TABLES) {
    await insertRows(name, columns, tables[name]);
    await synchronizeIdentity(name);
  }

  const sourceCounts = Object.fromEntries(
    IMPORT_TABLES.map(({ name }) => [name, tables[name].length]),
  );
  const destinationCounts = await collectCounts();
  for (const [name, sourceCount] of Object.entries(sourceCounts)) {
    if (destinationCounts[name] !== sourceCount) {
      throw new Error(
        `Conteo distinto en ${name}: SQLite=${sourceCount}, PostgreSQL=${destinationCounts[name]}.`,
      );
    }
  }

  if (mode === 'commit') {
    await client.query('COMMIT');
  } else {
    await client.query('ROLLBACK');
  }

  console.log(JSON.stringify({
    ok: true,
    mode,
    sqliteIntegrity: integrity,
    sourceCounts,
    destinationCounts,
    warnings,
    persisted: mode === 'commit',
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`[import-sqlite-to-postgres] ${error.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
