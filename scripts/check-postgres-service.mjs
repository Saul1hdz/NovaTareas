import 'dotenv/config';
import pg from 'pg';

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
  const tables = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'users', 'security_questions', 'categories', 'tasks', 'subtasks',
        'task_history', 'task_comments', 'task_embeddings',
        'task_recommendations', 'telegram_link_codes'
      )
  `);
  if (tables.rows[0].total !== 10) {
    throw new Error(`Se esperaban 10 tablas y se encontraron ${tables.rows[0].total}.`);
  }

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
    tables: tables.rows[0].total,
    transaction_rollback: true,
  }));
} finally {
  await pool.end();
}
