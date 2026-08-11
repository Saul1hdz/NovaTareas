// src/pages/api/v1/recommend.js
export const prerender = false;

import { validateTaskInput, generateRecommendation } from '../../../lib/aiEngine.js';
import {
  consumeRateLimit,
  getClientIp,
  safeEqualStrings,
  safeErrorSummary,
} from '../../../lib/security.js';

const AI_API_KEY = process.env.AI_API_KEY?.trim();

const RATE_LIMIT_MAX    = Number(process.env.AI_RATE_LIMIT_MAX)    || 20;
const RATE_LIMIT_WINDOW = Number(process.env.AI_RATE_LIMIT_WINDOW) || 5 * 60 * 1000;

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export async function POST({ request }) {
  if (!AI_API_KEY) {
    return json({ error: 'API externa no configurada.' }, 503);
  }
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match || !safeEqualStrings(match[1], AI_API_KEY)) {
    return json({ error: 'No autorizado.' }, 401);
  }

  const limit = await consumeRateLimit(
    'api-v1-recommend-ip',
    getClientIp(request),
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW
  );
  if (!limit.allowed) {
    return json(
      { error: 'Demasiadas peticiones. Espera unos minutos e inténtalo de nuevo.' },
      429,
      { 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  // 1. Parseo seguro del JSON
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'El cuerpo de la petición no es JSON válido.' }, 400);
  }

  // 2. Validación del contrato de entrada
  const validation = validateTaskInput(body);
  if (!validation.ok) {
    return json({ error: validation.error }, 400);
  }

  // 3. Generación de la recomendación
  try {
    const { text, source } = await generateRecommendation(validation.value);
    return json({
      recomendacion: text,
      fuente: source,
      tarea: {
        titulo:       validation.value.title,
        descripcion:  validation.value.description || null,
        prioridad:    validation.value.priority,
        tipo_usuario: validation.value.userType,
        fecha_limite: validation.value.dueDate,
      },
    }, 200);
  } catch (err) {
    console.error('[v1/recommend] error inesperado:', safeErrorSummary(err));
    return json({ error: 'Error interno al generar la recomendación.' }, 500);
  }
}

// Rechazo explícito de otros métodos con mensaje claro
export async function GET() {
  return json({ error: 'Método no permitido. Usa POST con un cuerpo JSON.' }, 405);
}
