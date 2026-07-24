import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let pool;
let database;

export function getPostgresDb() {
  if (database) return database;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL no está definida para PostgreSQL.');
  }

  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  database = drizzle(pool, { schema });
  return database;
}

export async function closePostgresDb() {
  if (pool) await pool.end();
  pool = undefined;
  database = undefined;
}
