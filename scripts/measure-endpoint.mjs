#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import 'dotenv/config';

/**
 * Línea base de rendimiento de NovaTareas.
 *
 * Ejecuta N solicitudes contra un escenario definido y publica p50, p95,
 * máximo y tasa de error. No mide "lo que tarda el servidor" en abstracto:
 * cada escenario fija endpoint, payload y autenticación, porque comparar dos
 * mediciones solo tiene sentido si el escenario es idéntico.
 *
 * Uso:
 *   node scripts/measure-endpoint.mjs --scenario=recommend --requests=30
 *   node scripts/measure-endpoint.mjs --scenario=recommend-invalid
 *   node scripts/measure-endpoint.mjs --scenario=tasks --concurrency=4
 *
 * Requiere la aplicación levantada (docker compose -f compose.dev.yml up -d web).
 */

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(arg => arg.startsWith('--'))
    .map(arg => {
      const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
      return [key, value];
    })
);

const BASE_URL = (args.url || process.env.MEASURE_BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');
const REQUESTS = Number(args.requests || 30);
const CONCURRENCY = Number(args.concurrency || 1);
const WARMUP = Number(args.warmup ?? 3);
const SCENARIO = args.scenario || 'recommend';
const OUT_DIR = args.out || 'docs/mediciones';

// La rúbrica exige al menos 20 solicitudes. Fallar aquí es preferible a
// entregar una medición que no cumple y descubrirlo al revisar el PDF.
if (!Number.isInteger(REQUESTS) || REQUESTS < 20) {
  console.error('La medición requiere al menos 20 solicitudes (--requests=20).');
  process.exit(1);
}

// ─── Escenarios ──────────────────────────────────────────────────────────────

const scenarios = {
  /** Flujo crítico: recomendación de IA por la API pública v1. */
  recommend: {
    description: 'POST /api/v1/recommend con payload válido (componente de IA)',
    expectedStatus: 200,
    async setup() {
      const key = process.env.AI_API_KEY?.trim();
      if (!key) {
        throw new Error(
          'AI_API_KEY no está definida. El endpoint responde 503 sin ella; ' +
          'defínela en .env antes de medir.'
        );
      }
      return { key };
    },
    request({ key }) {
      return {
        url: `${BASE_URL}/api/v1/recommend`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            titulo: 'Preparar informe mensual de ventas',
            descripcion: 'Consolidar los datos del trimestre y redactar conclusiones.',
            prioridad: 'alta',
            tipo_usuario: 'empleado',
            fecha_limite: '2026-09-15',
          }),
        },
      };
    },
  },

  /** Mismo endpoint con entrada inválida: mide el camino de error controlado. */
  'recommend-invalid': {
    description: 'POST /api/v1/recommend sin el campo obligatorio "titulo" (error controlado)',
    expectedStatus: 400,
    setup: () => scenarios.recommend.setup(),
    request({ key }) {
      return {
        url: `${BASE_URL}/api/v1/recommend`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ descripcion: 'Falta el titulo', prioridad: 'alta' }),
        },
      };
    },
  },

  /**
   * Control: ruta sin sesión ni consulta de negocio. Sirve para separar el
   * coste del endpoint del techo del propio servidor. Sin esta referencia,
   * cualquier latencia se atribuye a la consulta por defecto.
   */
  health: {
    description: 'GET /api/v1/health (control: sin autenticación ni consulta de negocio)',
    expectedStatus: 200,
    setup: async () => ({}),
    request() {
      return { url: `${BASE_URL}/api/v1/health`, init: { method: 'GET' } };
    },
  },

  /** Camino crítico del dashboard: listar tareas del usuario autenticado. */
  tasks: {
    description: 'GET /api/tasks del usuario autenticado (consulta principal del dashboard)',
    expectedStatus: 200,
    async setup() {
      const email = process.env.MEASURE_USER_EMAIL;
      const password = process.env.MEASURE_USER_PASSWORD;
      if (!email || !password) {
        throw new Error(
          'Define MEASURE_USER_EMAIL y MEASURE_USER_PASSWORD en .env con una ' +
          'cuenta ficticia de pruebas para medir este escenario.'
        );
      }

      const response = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        throw new Error(`No se pudo iniciar sesión para medir (HTTP ${response.status}).`);
      }
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (!cookie) throw new Error('El login no devolvió cookie de sesión.');
      return { cookie };
    },
    request({ cookie }) {
      return {
        url: `${BASE_URL}/api/tasks?archived=0`,
        init: { method: 'GET', headers: { Cookie: cookie } },
      };
    },
  },
};

// ─── Estadística ─────────────────────────────────────────────────────────────

/**
 * Percentil por interpolación lineal sobre la muestra ordenada.
 * Con 30 muestras, el p95 "por índice" saltaría directamente al máximo y daría
 * una cifra optimista o pesimista según el redondeo.
 */
export function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const position = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];

  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function round(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function summarize(samples) {
  const durations = samples.map(sample => sample.duration_ms).sort((a, b) => a - b);
  const errors = samples.filter(sample => !sample.ok);

  return {
    requests: samples.length,
    errors: errors.length,
    error_rate: round((errors.length / samples.length) * 100),
    p50_ms: round(percentile(durations, 0.5)),
    p95_ms: round(percentile(durations, 0.95)),
    max_ms: round(durations[durations.length - 1] ?? null),
    min_ms: round(durations[0] ?? null),
    avg_ms: round(durations.reduce((total, value) => total + value, 0) / durations.length),
    status_codes: samples.reduce((counts, sample) => {
      const key = String(sample.status);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
  };
}

// ─── Ejecución ───────────────────────────────────────────────────────────────

async function runOnce(scenario, context) {
  const { url, init } = scenario.request(context);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, init);
    // Se consume el cuerpo: sin esto la medición terminaría antes de que el
    // servidor haya escrito la respuesta completa y el tiempo saldría corto.
    await response.text();
    const duration = performance.now() - startedAt;

    return {
      duration_ms: Math.round(duration * 100) / 100,
      status: response.status,
      ok: response.status === scenario.expectedStatus,
      request_id: response.headers.get('x-request-id'),
    };
  } catch (error) {
    return {
      duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      status: 0,
      ok: false,
      error_type: error?.name || 'FetchError',
    };
  }
}

async function main() {
  const scenario = scenarios[SCENARIO];
  if (!scenario) {
    console.error(`Escenario desconocido: ${SCENARIO}`);
    console.error(`Disponibles: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }

  console.error(`Escenario   : ${SCENARIO} — ${scenario.description}`);
  console.error(`Destino     : ${BASE_URL}`);
  console.error(`Solicitudes : ${REQUESTS} (concurrencia ${CONCURRENCY}, calentamiento ${WARMUP})`);

  const context = await scenario.setup();

  // El calentamiento no entra en la muestra: la primera solicitud paga la
  // compilación del módulo y la apertura del pool de PostgreSQL, y arrastraría
  // el máximo y el p95 hacia arriba sin representar el estado estable.
  for (let index = 0; index < WARMUP; index += 1) {
    await runOnce(scenario, context);
  }

  const samples = [];
  const startedAt = Date.now();
  let launched = 0;

  async function worker() {
    while (launched < REQUESTS) {
      launched += 1;
      samples.push(await runOnce(scenario, context));
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker())
  );

  const wallClockMs = Date.now() - startedAt;
  const summary = summarize(samples);

  const report = {
    scenario: SCENARIO,
    description: scenario.description,
    base_url: BASE_URL,
    measured_at: new Date().toISOString(),
    app_version: process.env.APP_VERSION || 'dev',
    ai_model: process.env.ZAI_MODEL || 'glm-4.5-flash',
    ai_configured: Boolean(process.env.ZAI_API_KEY?.trim()),
    concurrency: CONCURRENCY,
    warmup: WARMUP,
    wall_clock_ms: wallClockMs,
    throughput_rps: Math.round((samples.length / (wallClockMs / 1000)) * 100) / 100,
    ...summary,
    samples,
  };

  const stamp = report.measured_at.replace(/[:.]/g, '-');
  const jsonPath = join(OUT_DIR, `${SCENARIO}-${stamp}.json`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(formatTable(report));
  console.error(`\nResultado guardado en ${jsonPath}`);

  return report;
}

function formatTable(report) {
  const rows = [
    ['Escenario', report.scenario],
    ['Solicitudes', String(report.requests)],
    ['Concurrencia', String(report.concurrency)],
    ['p50 (ms)', String(report.p50_ms)],
    ['p95 (ms)', String(report.p95_ms)],
    ['Máximo (ms)', String(report.max_ms)],
    ['Mínimo (ms)', String(report.min_ms)],
    ['Promedio (ms)', String(report.avg_ms)],
    ['Tasa de error (%)', String(report.error_rate)],
    ['Códigos', JSON.stringify(report.status_codes)],
    ['Throughput (req/s)', String(report.throughput_rps)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join('\n');
}

// Solo se ejecuta como script; al importarlo desde las pruebas no lanza nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`\nMedición interrumpida: ${error.message}`);
    process.exit(1);
  });
}
