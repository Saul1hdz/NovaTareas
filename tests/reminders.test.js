import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as runReminders } from '../src/pages/api/cron/reminders.js';
import { getDb } from '../src/lib/db.js';
import { createToken } from '../src/lib/auth.js';
import { POST as createTask } from '../src/pages/api/tasks.js';
import { defaultReminderFor, instantInAppTimeZone } from '../src/lib/appTime.js';
import {
  completionDueLabel,
  dateInAppTimeZone,
} from '../src/lib/telegramNotify.js';

function cronRequest() {
  return new Request('http://127.0.0.1:4321/api/cron/reminders', {
    headers: { Authorization: 'Bearer cron-solo-para-pruebas' },
  });
}

async function createReminderFixture(suffix) {
  const db = getDb();
  const user = await db.prepare(`
    INSERT INTO users
      (username, full_name, email, password_hash, telefono, telegram_chat_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `).get(
    `recordatorios-${suffix}`,
    `Recordatorios ${suffix}`,
    `recordatorios-${suffix}@example.test`,
    '$2b$10$hash-ficticio',
    '+50370009999',
    `chat-${suffix}`,
  );
  const userId = user.id;

  // Un Date, no una cadena sin zona: PostgreSQL interpretaría
  // 'YYYY-MM-DD HH:mm:ss' según la zona del servidor y la ventana de
  // recordatorios se desplazaría sin que ninguna prueba fallara.
  const reminderAt = new Date(Date.now() + 5 * 60 * 1000);
  const reminder = await db.prepare(`
    INSERT INTO tasks (user_id, title, due_date, reminder_at)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `).get(userId, `Recordatorio ${suffix}`, '2026-08-01', reminderAt);
  const overdue = await db.prepare(`
    INSERT INTO tasks (user_id, title, due_date)
    VALUES ($1, $2, $3)
    RETURNING id
  `).get(userId, `Vencida ${suffix}`, '2020-01-01');

  return { db, reminderId: reminder.id, overdueId: overdue.id };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('recordatorios deterministas', { sequential: true }, () => {
  it('usa el tiempo verbal correcto al completar una tarea', () => {
    expect(completionDueLabel('2026-07-25', '2026-07-24')).toContain('vence el');
    expect(completionDueLabel('2026-07-24', '2026-07-24')).toBe(' (vence hoy)');
    expect(completionDueLabel('2026-07-23', '2026-07-24')).toContain('vencía el');
  });

  it('calcula el día de la aplicación en America/El_Salvador', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T04:30:00.000Z'));
    expect(dateInAppTimeZone()).toBe('2026-07-23');
  });

  it('marca recordatorios y vencidas solo una vez después de entregar', async () => {
    const { db, reminderId, overdueId } = await createReminderFixture('entrega');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '000000000:telegram-solo-para-pruebas');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await runReminders({ request: cronRequest() });
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ reminders_sent: 1, overdue_alerts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await db.prepare(
      'SELECT reminder_sent FROM tasks WHERE id = $1'
    ).get(reminderId)).reminder_sent).toBe(true);
    expect((await db.prepare(
      'SELECT overdue_notified FROM tasks WHERE id = $1'
    ).get(overdueId)).overdue_notified).toBe(true);

    const second = await runReminders({ request: cronRequest() });
    expect(await second.json()).toMatchObject({ reminders_sent: 0, overdue_alerts: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no marca como enviado cuando Telegram rechaza la solicitud', async () => {
    const { db, reminderId, overdueId } = await createReminderFixture('rechazo');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '000000000:telegram-solo-para-pruebas');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    );

    const response = await runReminders({ request: cronRequest() });
    expect(await response.json()).toMatchObject({ reminders_sent: 0, overdue_alerts: 0 });
    expect((await db.prepare(
      'SELECT reminder_sent FROM tasks WHERE id = $1'
    ).get(reminderId)).reminder_sent).toBe(false);
    expect((await db.prepare(
      'SELECT overdue_notified FROM tasks WHERE id = $1'
    ).get(overdueId)).overdue_notified).toBe(false);
  });
});

describe('programación de recordatorios', () => {
  it('calcula la mañana de la fecha límite en la zona de la aplicación', () => {
    // America/El_Salvador es UTC-6: las 09:00 locales son las 15:00 UTC.
    const instante = instantInAppTimeZone('2030-03-15');
    expect(instante.toISOString()).toBe('2030-03-15T15:00:00.000Z');
  });

  it('no programa un aviso para una fecha que ya pasó', () => {
    expect(defaultReminderFor('2020-01-01')).toBeNull();
    expect(defaultReminderFor(null)).toBeNull();
  });

  it('guarda reminder_at al crear una tarea con fecha límite', async () => {
    // Antes esta columna quedaba siempre nula y el aviso previo al vencimiento
    // no se disparaba nunca, aunque el cron lo consultara.
    const user = await getDb().prepare(`
      INSERT INTO users (username, full_name, email, password_hash, telefono)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `).get('prog', 'Programación', 'programacion@example.test', '$2b$10$hash-ficticio', '+50370002222');

    const token = await createToken(user.id, 'prog', 0);
    const response = await createTask({
      request: new Request('http://127.0.0.1:4321/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `novatareas_token=${token}`,
        },
        body: JSON.stringify({ title: 'Con recordatorio', due_date: '2030-05-20' }),
      }),
    });
    expect(response.status).toBe(201);

    const { id } = await response.json();
    const stored = await getDb().prepare(
      'SELECT reminder_at FROM tasks WHERE id = $1'
    ).get(id);
    expect(stored.reminder_at).not.toBeNull();
    expect(new Date(stored.reminder_at).toISOString()).toBe('2030-05-20T15:00:00.000Z');
  });
});
