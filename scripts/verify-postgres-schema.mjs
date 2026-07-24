import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const client = await PGlite.create();
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: './migrations/postgresql' });
  await migrate(db, { migrationsFolder: './migrations/postgresql' });

  const tables = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  const constraints = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
  `);
  console.log(JSON.stringify({
    engine: 'PostgreSQL (PGlite)',
    tables: tables.rows.map(row => row.tablename),
    constraints: constraints.rows[0].count,
    reapplied: true,
  }, null, 2));
} finally {
  await client.close();
}
