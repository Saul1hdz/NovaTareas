import { safeErrorSummary } from '../security.js';

/**
 * Proveedores de IA: una sola definición para toda la aplicación.
 *
 * Este código estaba copiado en cuatro archivos (aiEngine.js, el endpoint de
 * recomendaciones, el de comentarios y el bot de Telegram) con timeouts que iban
 * de 25 a 45 segundos, límites de tokens distintos y dos copias sin el chequeo
 * previo de Ollama —esas esperaban quince segundos a un puerto cerrado en cada
 * petición—. Cambiar el modelo o un tiempo de espera obligaba a tocar los cuatro.
 */

export const ZAI_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
export const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-4.5-flash';
export const ZAI_API_KEY = process.env.ZAI_API_KEY?.trim();

// Configurable para poder apuntar a un proxy propio o a un doble local en las
// pruebas de extremo a extremo; en producción se deja el valor por defecto.
export const OPENROUTER_URL =
  process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'stealth/ox-alpha';
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

const ZAI_TIMEOUT_MS = 45_000;
const OPENROUTER_TIMEOUT_MS = 45_000;
const OLLAMA_TIMEOUT_MS = 20_000;
const OLLAMA_PING_TIMEOUT_MS = 1_500;

/**
 * Recorta un texto truncado por el límite de tokens hasta la última frase
 * completa, para no terminar a media palabra.
 */
export function trimToCompleteSentence(text) {
  if (!text) return text;

  const trimmed = text.trim();
  if (/[.!?…]$/.test(trimmed)) return trimmed;

  const lastStop = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('?'),
  );
  if (lastStop > trimmed.length * 0.7) return trimmed.slice(0, lastStop + 1);

  const lastComma = trimmed.lastIndexOf(',');
  if (lastComma > trimmed.length * 0.5) return `${trimmed.slice(0, lastComma)}.`;

  return trimmed;
}

export async function callZai(prompt, { maxTokens = 700, temperature = 0.7 } = {}) {
  if (!ZAI_API_KEY) return null;

  try {
    const response = await fetch(ZAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(ZAI_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error('[ia] z.ai respondió', response.status);
      return null;
    }

    const data = await response.json().catch(() => null);
    return trimToCompleteSentence(data?.choices?.[0]?.message?.content?.trim() || null);
  } catch (error) {
    console.error('[ia] z.ai no disponible:', safeErrorSummary(error));
    return null;
  }
}

/**
 * OpenRouter, con el mismo contrato que `callZai`: devuelve texto o `null`.
 *
 * El modelo por defecto es `stealth/ox-alpha`, y razonar no es opcional en él:
 * mandarle `reasoning: { enabled: false }` devuelve un **400** —«Reasoning is
 * mandatory for this endpoint and cannot be disabled»—. Lo que sí se puede es
 * `exclude: true`, que le deja razonar sin devolver esos tokens.
 *
 * Consecuencia: el razonamiento se cobra del mismo presupuesto que la respuesta
 * —55 tokens para contestar «hola» en una frase—, así que el límite va al
 * triple que en z.ai. Si aun así se agota antes de escribir, `content` llega
 * vacío con un 200; por eso un contenido vacío se trata como fallo y quien
 * llama sigue la cascada en lugar de guardar una recomendación en blanco.
 */
export async function callOpenRouter(prompt, { maxTokens = 2_100, temperature = 0.7 } = {}) {
  if (!OPENROUTER_API_KEY) return null;

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        // Atribución que pide OpenRouter para identificar de dónde vienen las
        // peticiones. No es obligatoria, pero sin ella la app aparece anónima
        // en el panel de uso y no se puede saber qué consumió qué.
        'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://novatareas.polarzero.dev',
        'X-Title': 'NovaTareas',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
        reasoning: { exclude: true },
      }),
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error('[ia] OpenRouter respondió', response.status);
      return null;
    }

    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error('[ia] OpenRouter devolvió un contenido vacío');
      return null;
    }
    return trimToCompleteSentence(text);
  } catch (error) {
    console.error('[ia] OpenRouter no disponible:', safeErrorSummary(error));
    return null;
  }
}

/**
 * Router de proveedores remotos: OpenRouter primero, z.ai como respaldo.
 *
 * Devuelve también de dónde salió el texto y con qué modelo, porque eso se
 * persiste en `task_recommendations` y se anota en observabilidad. Cada llamante
 * tenía su propio `if (ZAI_API_KEY) { ... }` copiado; ahora el orden de los
 * proveedores remotos se decide en un solo sitio.
 */
export async function callRemote(prompt, options = {}) {
  if (OPENROUTER_API_KEY) {
    const text = await callOpenRouter(prompt, options);
    if (text) return { text, source: 'openrouter', model: OPENROUTER_MODEL };
  }

  if (ZAI_API_KEY) {
    const text = await callZai(prompt, options);
    if (text) return { text, source: 'zai', model: ZAI_MODEL };
  }

  return { text: null, source: null, model: null };
}

/** Comprueba que Ollama esté escuchando antes de enviarle una petición larga. */
export async function isOllamaUp() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_PING_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function callOllama(prompt, { numPredict = 400, temperature = 0.7 } = {}) {
  // El chequeo previo evita esperar el timeout completo cuando Ollama no está
  // instalado, que es el caso habitual en el servidor.
  if (!(await isOllamaUp())) return null;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature, num_predict: numPredict },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = await response.json().catch(() => null);
    return trimToCompleteSentence(data?.response?.trim() || null);
  } catch (error) {
    console.error('[ia] Ollama no disponible:', safeErrorSummary(error));
    return null;
  }
}

/**
 * Cascada estándar: OpenRouter → z.ai → Ollama → los respaldos que indique
 * quien llama. Devuelve también de dónde salió el texto, para poder registrarlo.
 */
export async function runCompletion(prompt, { remote, ollama, fallbacks = [] } = {}) {
  const primary = await callRemote(prompt, remote);
  if (primary.text) return primary;

  const local = await callOllama(prompt, ollama);
  if (local) return { text: local, source: 'ollama', model: OLLAMA_MODEL };

  for (const { source, resolve } of fallbacks) {
    const resolved = await resolve();
    if (resolved) return { text: resolved, source, model: null };
  }

  return { text: null, source: null, model: null };
}
