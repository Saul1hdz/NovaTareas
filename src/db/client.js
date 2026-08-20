// Astro y Vite solo exponen las variables de `.env` a `import.meta.env`, no a
// `process.env`, así que en ejecución nativa (`npm run dev`) el servidor no vería
// DATABASE_URL. En Docker y en producción las variables ya vienen del entorno y
// esta carga no hace nada.
import 'dotenv/config';
import pg from 'pg';
import { recordDbQuery } from '../lib/observability.js';

// ─── Parseo de tipos ─────────────────────────────────────────────────────────
//
// Ambos ajustes son obligatorios y sus fallos son silenciosos, no ruidosos.

// BIGINT (OID 20). `COUNT(*)` llega como cadena por defecto, así que un
// `total - done` produciría resultados absurdos en las estadísticas.
pg.types.setTypeParser(20, Number);

// DATE (OID 1082). Por defecto pg lo convierte a un Date a medianoche local,
// lo que desplaza el día al serializarlo. Toda la aplicación trata `due_date`
// como la cadena 'YYYY-MM-DD', que es justo lo que PostgreSQL devuelve.
pg.types.setTypeParser(1082, value => value);

/**
 * Envoltorio delgado sobre `pg`.
 *
 * Sustituye a la antigua capa de compatibilidad con SQLite, que reescribía el
 * SQL con expresiones regulares y adivinaba el tipo de cada parámetro a partir
 * del texto de la consulta. Aquí no se inspecciona ni se transforma nada: el
 * SQL sale tal cual está escrito. Se conserva `prepare()` porque hay código que
 * reutiliza una sentencia en bucle y porque las transacciones inyectan un
 * objeto con esta misma interfaz.
 */
class Database {
  constructor(pool, client = null) {
    this.pool = pool;
    this.client = client;
  }

  async query(text, values = []) {
    // Toda consulta pasa por aquí, así que es el único punto donde hay que
    // instrumentar para saber cuánto de una solicitud se va en PostgreSQL.
    // Se mide el tiempo, no el SQL ni los parámetros: esos llevan datos del
    // usuario y no deben acabar en un log.
    const startedAt = performance.now();
    try {
      return await (this.client || this.pool).query(text, values);
    } finally {
      recordDbQuery(performance.now() - startedAt);
    }
  }

  prepare(sql) {
    return {
      get: async (...values) => (await this.query(sql, values)).rows[0],
      all: async (...values) => (await this.query(sql, values)).rows,
      run: async (...values) => {
        const result = await this.query(sql, values);
        return { rowCount: result.rowCount, rows: result.rows };
      },
    };
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(new Database(this.pool, client));
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

export function createDatabase(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_URL es obligatoria: PostgreSQL es el único motor soportado.');
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

  return new Database(pool);
}
