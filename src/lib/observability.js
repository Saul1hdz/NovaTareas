import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Observabilidad de NovaTareas: un evento estructurado por solicitud.
 *
 * El objetivo no es "tener logs", sino poder responder preguntas concretas
 * cuando algo va mal en la demo o en el servidor (ver docs/OBSERVABILIDAD.md):
 * qué solicitud fue, qué ruta ejecutó, si terminó bien, cuánto tardó, qué
 * componente de IA respondió y de qué tipo fue el fallo cuando lo hubo.
 *
 * Dos decisiones que conviene no deshacer:
 *
 * 1. Se emite **una** línea JSON por solicitud, no varias. Correlacionar a mano
 *    líneas sueltas de `console.log` era justo el problema que había antes.
 * 2. Los campos son una **lista blanca**. Nada que no esté en `EVENT_FIELDS`
 *    llega a la salida, así que un cuerpo de petición, una cabecera de
 *    autorización o una contraseña no pueden filtrarse por descuido.
 */

const storage = new AsyncLocalStorage();

// Único sitio donde se decide qué se publica. Añadir un campo aquí es una
// decisión consciente; escribirlo en `annotate()` sin añadirlo aquí no hace nada.
const EVENT_FIELDS = [
  'ts',             // instante ISO-8601 en UTC
  'level',          // info | warn | error
  'event',          // http_request
  'request_id',     // correlación de la solicitud
  'method',
  'route',          // plantilla: /api/tasks/:id, no la URL con parámetros
  'status',         // código HTTP
  'outcome',        // success | client_error | server_error
  'duration_ms',    // duración total de la solicitud
  'app_version',    // versión del código desplegado
  'ai_component',   // componente inteligente que atendió (si aplica)
  'ai_source',      // zai | ollama | history | rules
  'ai_model',       // modelo concreto que respondió
  'ai_prompt_version',
  'ai_duration_ms', // cuánto de la solicitud se fue en la IA
  'ai_fallback',    // true si hubo que degradar a un respaldo
  'error_type',     // clase de error, nunca su mensaje crudo
  'db_queries',     // consultas ejecutadas durante la solicitud
  'db_duration_ms', // tiempo acumulado dentro de PostgreSQL
];

// Campos que el código de la aplicación puede añadir al evento en curso.
// `status`, `duration_ms` y compañía los fija el middleware, no la ruta.
const ANNOTATABLE = new Set([
  'ai_component',
  'ai_source',
  'ai_model',
  'ai_prompt_version',
  'ai_duration_ms',
  'ai_fallback',
  'error_type',
  'db_queries',
]);

export const APP_VERSION = process.env.APP_VERSION?.trim() || 'dev';

/** Rutas que no aportan nada al diagnóstico y ensucian la salida. */
const IGNORED_PREFIXES = ['/_astro/', '/_image', '/favicon', '/avatars/'];

export function shouldLogPath(pathname) {
  return !IGNORED_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/**
 * Convierte una URL concreta en la plantilla de su ruta.
 *
 * Se registra `/api/tasks/:id/comments`, no `/api/tasks/42/comments`, por dos
 * razones: agrupar métricas por endpoint y no arrastrar identificadores —o un
 * token de invitación— a un log que se comparte en un PDF.
 */
export function normalizeRoute(pathname) {
  return pathname
    .split('/')
    .map(segment => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ':id';
      // Tokens y códigos: cadenas largas sin forma de palabra.
      if (segment.length >= 16 && /[A-Za-z0-9_-]{16,}/.test(segment)) return ':token';
      return segment;
    })
    .join('/') || '/';
}

export function outcomeFor(status) {
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'success';
}

/**
 * Tipo de error publicable. Nunca el mensaje: puede arrastrar la consulta SQL,
 * una ruta del sistema de archivos o el valor que provocó el fallo.
 */
export function errorTypeOf(error) {
  const name = String(error?.name || '').trim();
  if (/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)) return name;

  const code = String(error?.code || '').trim();
  if (/^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;

  return 'UnknownError';
}

export function newRequestId() {
  return randomUUID();
}

/**
 * Acepta el `x-request-id` entrante para poder seguir una solicitud a través de
 * un proxy, pero solo si tiene forma inofensiva: es un valor de fuera y acaba
 * en el log.
 */
export function resolveRequestId(headerValue) {
  const candidate = String(headerValue || '').trim();
  return /^[A-Za-z0-9._-]{8,64}$/.test(candidate) ? candidate : newRequestId();
}

export function runWithRequestContext(seed, callback) {
  return storage.run({ ...seed }, callback);
}

export function currentContext() {
  return storage.getStore() || null;
}

/**
 * Añade información al evento de la solicitud en curso. Fuera de una solicitud
 * —por ejemplo en las pruebas unitarias o en el bot— no hace nada, que es justo
 * lo que se quiere: instrumentar no debe cambiar el comportamiento.
 */
export function annotate(fields) {
  const context = storage.getStore();
  if (!context || !fields) return;

  for (const [key, value] of Object.entries(fields)) {
    if (ANNOTATABLE.has(key) && value !== undefined && value !== null) {
      context[key] = value;
    }
  }
}

/**
 * Acumula una consulta a PostgreSQL en la solicitud en curso.
 *
 * Se acumula en vez de sobrescribir porque la pregunta que interesa responder
 * es "de los 16 ms de esta solicitud, ¿cuántos fueron base de datos?", y eso
 * solo se contesta sumando todas las consultas. Nunca se registra el SQL ni los
 * parámetros: llevan datos del usuario.
 */
export function recordDbQuery(durationMs) {
  const context = storage.getStore();
  if (!context) return;

  context.db_queries = (context.db_queries || 0) + 1;
  context.db_duration_ms = Math.round(
    ((context.db_duration_ms || 0) + durationMs) * 100
  ) / 100;
}

/** Mide una operación y anota su duración en el evento en curso. */
export async function trackDuration(field, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    annotate({ [field]: Math.round(performance.now() - startedAt) });
  }
}

function buildEvent(fields) {
  const event = {};
  for (const key of EVENT_FIELDS) {
    if (fields[key] !== undefined && fields[key] !== null) event[key] = fields[key];
  }
  return event;
}

/**
 * Escribe el evento como una única línea JSON en stdout.
 *
 * Una línea por evento es lo que hace que `docker compose logs` sea filtrable
 * con `grep`/`jq` sin herramientas extra, y lo que permitiría enviarlo a un
 * colector el día que exista uno.
 */
export function logRequestEvent(fields) {
  const event = buildEvent({
    ts: new Date().toISOString(),
    event: 'http_request',
    app_version: APP_VERSION,
    ...fields,
  });

  const line = JSON.stringify(event);
  if (event.level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);

  return event;
}

export const __testing__ = { EVENT_FIELDS, ANNOTATABLE };
