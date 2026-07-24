export const prerender = false;

import { handleUpdate } from '../../../lib/telegramBot.js';
import { safeEqualStrings, safeErrorSummary } from '../../../lib/security.js';

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

export async function POST({ request }) {
  if (!WEBHOOK_SECRET) {
    return new Response('Service Unavailable', { status: 503 });
  }

  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!receivedSecret || !safeEqualStrings(receivedSecret, WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    await handleUpdate(update);
  } catch (error) {
    console.error('[telegram/webhook] Error procesando update:', safeErrorSummary(error));
  }

  return new Response('OK', { status: 200 });
}
