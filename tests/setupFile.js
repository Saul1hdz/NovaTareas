import { afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { closeDb } from '../src/lib/db.js';
import { TEST_DATABASE_URL } from './databaseUrl.js';

// Cada archivo de pruebas arranca con la base vacía. `RESTART IDENTITY` es
// obligatorio: varias pruebas asumen que el primer usuario registrado tiene
// id = 1, algo que solo es cierto si las secuencias vuelven a empezar.

async function truncateAllTables() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    if (rows.length === 0) return;

    const tables = rows.map(row => `public."${row.tablename}"`).join(', ');
    await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await truncateAllTables();
});

// Vitest aísla los módulos por archivo, así que cada uno instancia su propio
// pool. Sin cerrarlo, el proceso queda colgado al terminar la suite.
afterAll(async () => {
  await closeDb();
});
