import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as runReminders } from '../src/pages/api/cron/reminders.js';
import { getDb } from '../src/lib/db.js';
import {
  completionDueLabel,
  dateInAppTimeZone,
} from '../src/lib/telegramNotify.js';

function cronRequest() {
  return new Request('http://127.0.0.1:4321/api/cron/reminders', {
    headers: { Authorization: 'Bearer cron-solo-para-pruebas' },
  });
}

function createReminderFixture(suffix) {
  const db = getDb();
  const userId = Number(db.prepare(`
    INSERT INTO users
      (username, full_name, email, password_hash, telefono, telegram_chat_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `recordatorios-${suffix}`,
    `Recordatorios ${suffix}`,
    `recordatorios-${suffix}@example.test`,
    '$2b$10$hash-ficticio',
    '+50370009999',
    `chat-${suffix}`,
  ).lastInsertRowid);

  const reminderAt = new Date(Date.now() + 5 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');
  const reminderId = Number(db.prepare(`
    INSERT INTO tasks (user_id, title, due_date, reminder_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, `Recordatorio ${suffix}`, '2026-08-01', reminderAt).lastInsertRowid);
  const overdueId = Number(db.prepare(`
    INSERT INTO tasks (user_id, title, due_date)
    VALUES (?, ?, ?)
  `).run(userId, `Vencida ${suffix}`, '2020-01-01').lastInsertRowid);

  return { db, reminderId, overdueId };
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
    const { db, reminderId, overdueId } = createReminderFixture('entrega');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '000000000:telegram-solo-para-pruebas');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await runReminders({ request: cronRequest() });
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ reminders_sent: 1, overdue_alerts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.prepare(
      'SELECT reminder_sent FROM tasks WHERE id = ?'
    ).get(reminderId).reminder_sent).toBe(1);
    expect(db.prepare(
      'SELECT overdue_notified FROM tasks WHERE id = ?'
    ).get(overdueId).overdue_notified).toBe(1);

    const second = await runReminders({ request: cronRequest() });
    expect(await second.json()).toMatchObject({ reminders_sent: 0, overdue_alerts: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no marca como enviado cuando Telegram rechaza la solicitud', async () => {
    const { db, reminderId, overdueId } = createReminderFixture('rechazo');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '000000000:telegram-solo-para-pruebas');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    );

    const response = await runReminders({ request: cronRequest() });
    expect(await response.json()).toMatchObject({ reminders_sent: 0, overdue_alerts: 0 });
    expect(db.prepare(
      'SELECT reminder_sent FROM tasks WHERE id = ?'
    ).get(reminderId).reminder_sent).toBe(0);
    expect(db.prepare(
      'SELECT overdue_notified FROM tasks WHERE id = ?'
    ).get(overdueId).overdue_notified).toBe(0);
  });
});
