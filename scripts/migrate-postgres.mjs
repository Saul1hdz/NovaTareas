import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closePostgresDb, getPostgresDb } from '../src/db/postgres/client.js';

if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL no está definida. No se aplicó ninguna migración.');
  process.exit(1);
}

try {
  await migrate(getPostgresDb(), {
    migrationsFolder: './migrations/postgresql',
  });
  console.log('Migraciones PostgreSQL aplicadas correctamente.');
} finally {
  await closePostgresDb();
}
