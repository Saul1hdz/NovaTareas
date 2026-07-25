import 'dotenv/config';
import { getTableName } from 'drizzle-orm';
import pg from 'pg';
import { postgresSchema } from '../src/db/postgres/schema.js';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error('DATABASE_URL no está definida para comprobar PostgreSQL.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: 5_000,
});

try {
  // Las tablas esperadas se derivan del esquema, no de una lista escrita a
  // mano: así añadir una tabla nueva no deja esta comprobación ciega sin que
  // nadie se entere.
  const esperadas = Object.values(postgresSchema).map(getTableName).sort();
  const encontradas = (await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  )).rows.map(row => row.tablename);

  const faltantes = esperadas.filter(nombre => !encontradas.includes(nombre));
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan ${faltantes.length} tablas en PostgreSQL: ${faltantes.join(', ')}. ` +
      '¿Se aplicaron todas las migraciones?'
    );
  }
  console.log(`Tablas verificadas: ${esperadas.length}.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(`
      INSERT INTO users
        (username, full_name, email, password_hash, telefono)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      'ci-ficticio',
      'CI Ficticio',
      'ci-postgres@example.test',
      '$2b$10$hash-ficticio',
      '+50370007777',
    ]);
    await client.query(`
      INSERT INTO tasks (user_id, title, due_date)
      VALUES ($1, $2, $3)
    `, [user.rows[0].id, 'Transacción ficticia de CI', '2026-08-15']);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const rolledBack = await pool.query(
    'SELECT COUNT(*)::int AS total FROM users WHERE email = $1',
    ['ci-postgres@example.test'],
  );
  if (rolledBack.rows[0].total !== 0) {
    throw new Error('La transacción ficticia no se revirtió.');
  }

  console.log(JSON.stringify({
    ok: true,
    engine: 'PostgreSQL service',
    tables: esperadas.length,
    transaction_rollback: true,
  }));
} finally {
  await pool.end();
}
