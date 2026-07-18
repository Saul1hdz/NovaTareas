// src/pages/api/v1/recommend.js
export const prerender = false;

import { validateTaskInput, generateRecommendation } from '../../../lib/aiEngine.js';

// ── Rate limiting simple en memoria (protege el saldo de z.ai) ───────────────
const RATE_LIMIT_MAX    = Number(process.env.AI_RATE_LIMIT_MAX)    || 20;
const RATE_LIMIT_WINDOW = Number(process.env.AI_RATE_LIMIT_WINDOW) || 5 * 60 * 1000;
const rateLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now   = Date.now();
  const calls = (rateLog.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  calls.push(now);
  rateLog.set(ip, calls);
  return calls.length > RATE_LIMIT_MAX;
}

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, clientAddress }) {
  const ip = clientAddress || 'unknown';

  if (isRateLimited(ip)) {
    return json({ error: 'Demasiadas peticiones. Espera unos minutos e inténtalo de nuevo.' }, 429);
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
    console.error('[v1/recommend] error inesperado:', err);
    return json({ error: 'Error interno al generar la recomendación.' }, 500);
  }
}

// Rechazo explícito de otros métodos con mensaje claro
export async function GET() {
  return json({ error: 'Método no permitido. Usa POST con un cuerpo JSON.' }, 405);
}
