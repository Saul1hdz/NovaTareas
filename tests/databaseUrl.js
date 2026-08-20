// Fuente única de la conexión de pruebas. Nunca reutiliza DATABASE_URL porque
// el setup destruye y recrea el esquema completo.
const configured = process.env.TEST_DATABASE_URL?.trim();

if (!configured) {
  throw new Error('TEST_DATABASE_URL es obligatoria para ejecutar la suite PostgreSQL.');
}

const parsed = new URL(configured);
if (!parsed.pathname.slice(1).endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en _test.');
}

export const TEST_DATABASE_URL = configured;
