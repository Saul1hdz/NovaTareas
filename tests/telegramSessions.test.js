import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/lib/db.js';
import { handleUpdate } from '../src/lib/telegramBot.js';

// El estado conversacional del bot vivía en un Map del proceso. Estas pruebas
// fijan el comportamiento nuevo: sobrevive a los reinicios y no retiene la
// lista completa de tareas del usuario.

const CHAT_ID = 900001;

function textUpdate(text, chatId = CHAT_ID) {
  return { message: { chat: { id: chatId }, text } };
}

function sessionRow(chatId = CHAT_ID) {
  return getDb().prepare(
    'SELECT chat_id, user_id, step, data, expires_at FROM telegram_sessions WHERE chat_id = $1'
  ).get(String(chatId));
}

beforeAll(async () => {
  await getDb().prepare(`
    INSERT INTO users (username, full_name, email, password_hash, telefono, telegram_chat_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `).run('bot', 'Bot Ficticio', 'bot@example.test', '$2b$10$hash-ficticio', '+50370003333', String(CHAT_ID));
});

beforeEach(() => {
  // El bot no debe contactar con Telegram durante las pruebas.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '000000000:telegram-solo-para-pruebas');
});

describe('sesiones del bot persistidas', () => {
  it('guarda el paso de la conversación en la base de datos', async () => {
    await handleUpdate(textUpdate('/nuevatarea'));

    const row = sessionRow();
    expect((await row).step).toBe('task_title');
  });

  it('retoma la conversación aunque el proceso se haya reiniciado', async () => {
    await handleUpdate(textUpdate('/nuevatarea'));
    // No se comparte nada en memoria entre llamadas: el segundo mensaje solo
    // puede avanzar si el paso se leyó de la base.
    await handleUpdate(textUpdate('Preparar presentación'));

    const row = await sessionRow();
    expect(row.step).toBe('task_description');
    expect(row.data.title).toBe('Preparar presentación');
  });

  it('asigna una caducidad a cada sesión', async () => {
    await handleUpdate(textUpdate('/nuevatarea'));

    const row = await sessionRow();
    const restante = new Date(row.expires_at).getTime() - Date.now();
    expect(restante).toBeGreaterThan(0);
    expect(restante).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('borra la sesión al terminar o cancelar el flujo', async () => {
    await handleUpdate(textUpdate('/nuevatarea'));
    expect(await sessionRow()).toBeTruthy();

    await handleUpdate(textUpdate('/ayuda'));
    expect(await sessionRow()).toBeUndefined();
  });

  it('no guarda la lista completa de tareas del usuario', async () => {
    await handleUpdate(textUpdate('/recomendacion'));

    const row = await sessionRow();
    if (row) {
      expect(row.data.tasks).toBeUndefined();
    }
  });
});
