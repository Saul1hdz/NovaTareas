/**
 * POST /api/telegram/webhook
 * Recibe actualizaciones del bot de Telegram y las despacha al handler.
 *
 * Configurar el webhook una sola vez:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tu-dominio.com/api/telegram/webhook
 */

export const prerender = false;

import { handleUpdate } from '../../../lib/telegramBot.js';

export async function POST({ request }) {
  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    await handleUpdate(update);
  } catch (err) {
    // Registrar pero responder 200 para evitar reenvíos de Telegram
    console.error('[telegram/webhook] Error procesando update:', err);
  }

  return new Response('OK', { status: 200 });
}
