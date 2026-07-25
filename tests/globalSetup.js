import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { TEST_DATABASE_URL } from './databaseUrl.js';

// Las pruebas usan el mismo motor que producción. Este setup deja la base en un
// estado idéntico al que produce `npm run db:pg:migrate` sobre una base vacía,
// así que además verifica en cada ejecución que las migraciones reales aplican.

const CONNECT_RETRIES = 10;
const RETRY_DELAY_MS = 1000;

function requireTestDatabaseUrl() {
  const url = TEST_DATABASE_URL;

  // Guarda de seguridad: este setup borra el esquema completo. Solo puede
  // apuntar a una base de pruebas.
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `DATABASE_URL apunta a "${databaseName}", que no termina en "_test". ` +
      'El setup de pruebas borra el esquema público y se niega a hacerlo ' +
      'sobre una base que no sea de pruebas.'
    );
  }

  return url;
}

async function connectWithRetries(url) {
  let lastError;
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt += 1) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      if (attempt < CONNECT_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(
    `No se pudo conectar a PostgreSQL tras ${CONNECT_RETRIES} intentos: ` +
    `${lastError?.message}\n` +
    'Comprueba que el contenedor esté arriba:\n' +
    '  docker compose -f compose.dev.yml up -d db'
  );
}

export default async function setup() {
  const url = requireTestDatabaseUrl();

  const client = await connectWithRetries(url);
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    // El migrador de Drizzle lleva su registro en un esquema aparte. Si no se
    // borra también, cree que las migraciones ya están aplicadas y no vuelve a
    // crear ninguna tabla.
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './migrations/postgresql' });
  } finally {
    await pool.end();
  }
}
