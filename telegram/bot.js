import 'dotenv/config';
import { safeErrorSummary } from '../src/lib/security.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN no está definido en .env');
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;

async function getUpdates() {
  const url = `${API_BASE}/getUpdates?timeout=30&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getUpdates error: ${res.status}`);
  return res.json();
}

// Importar handleUpdate después de configurar el entorno
const { handleUpdate } = await import('../src/lib/telegramBot.js');

async function poll() {
  console.log('[bot] Iniciando long-polling...');
  await fetch(`${API_BASE}/deleteWebhook`).catch(() => {});

  while (true) {
    try {
      const { ok, result } = await getUpdates();
      if (!ok || !result) continue;

      for (const update of result) {
        offset = update.update_id + 1;
        handleUpdate(update).catch((err) =>
          console.error('[bot] Error en update:', safeErrorSummary(err))
        );
      }
    } catch (err) {
      console.error('[bot] Error en polling:', safeErrorSummary(err));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

poll();
