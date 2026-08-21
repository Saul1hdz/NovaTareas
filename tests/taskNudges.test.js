import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NUDGE_HOURS,
  claimTaskNudge,
  getTasksNeedingNudge,
  hourInAppTimeZone,
  isQuietHour,
  markNudgeSent,
  nudgeHours,
  nudgesEnabled,
  releaseTaskNudgeClaim,
} from '../src/lib/taskNudges.js';
import { notifyTaskNudges } from '../src/lib/telegramNotify.js';
import { getDb } from '../src/lib/db.js';

// Recordatorios recurrentes por Telegram según la prioridad.
//
// Ninguna prueba envía un mensaje real: `sendMessage` sale sin hacer nada
// cuando falta TELEGRAM_BOT_TOKEN, que es el caso en el entorno de pruebas. Eso
// importa porque el bot del proyecto corre en producción con usuarios reales.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('interruptor y frecuencia', () => {
  it('viene apagado, para no escribirle a nadie al desplegar', () => {
    expect(nudgesEnabled()).toBe(false);
    vi.stubEnv('TASK_NUDGES_ENABLED', 'true');
    expect(nudgesEnabled()).toBe(true);
  });

  it('usa la frecuencia pedida por prioridad', () => {
    expect(DEFAULT_NUDGE_HOURS).toEqual({ urgente: 1, alta: 3, media: 5, baja: 6 });
  });

  it('permite ajustarla por entorno', () => {
    vi.stubEnv('NUDGE_HOURS_URGENTE', '2');
    expect(nudgeHours().urgente).toBe(2);
  });

  it('ignora valores absurdos y se queda con el de por defecto', () => {
    // Un cero convertiría el recordatorio en un bucle de mensajes por barrido.
    for (const valor of ['0', '-3', 'cada rato', '9999', '']) {
      vi.stubEnv('NUDGE_HOURS_URGENTE', valor);
      expect(nudgeHours().urgente).toBe(1);
    }
  });
});

describe('horas de silencio', () => {
  // `APP_TIME_ZONE` se resuelve al importar el módulo, así que no se puede
  // sustituir desde aquí. Estas pruebas se construyen sobre la hora real de la
  // zona configurada y así valen sea cual sea: lo que se comprueba es la lógica
  // del tramo, no en qué país está el servidor.
  const base = new Date('2026-08-18T12:00:00Z');
  const hora = hourInAppTimeZone(base);

  /** Un instante cuya hora local sea exactamente la pedida. */
  function instanteConHoraLocal(objetivo) {
    for (let salto = 0; salto < 48; salto += 1) {
      const fecha = new Date(base.getTime() + salto * 3600_000);
      if (hourInAppTimeZone(fecha) === objetivo) return fecha;
    }
    throw new Error(`No se encontró un instante con hora local ${objetivo}`);
  }

  it('devuelve una hora válida de la zona configurada', () => {
    expect(Number.isInteger(hora)).toBe(true);
    expect(hora).toBeGreaterThanOrEqual(0);
    expect(hora).toBeLessThanOrEqual(23);
  });

  it('la medianoche es 0 y no 24', () => {
    // Intl con `hour12: false` usa el ciclo h24 y devuelve 24 a medianoche. Un
    // tramo de silencio 00:00-07:00 no contendría ese 24 y el bot avisaría a
    // las doce de la noche.
    const medianoche = instanteConHoraLocal(0);
    expect(hourInAppTimeZone(medianoche)).toBe(0);

    vi.stubEnv('NUDGE_QUIET_FROM', '0');
    vi.stubEnv('NUDGE_QUIET_TO', '7');
    expect(isQuietHour(medianoche)).toBe(true);
  });

  it('calla dentro del tramo y deja avisar fuera', () => {
    vi.stubEnv('NUDGE_QUIET_FROM', String(hora));
    vi.stubEnv('NUDGE_QUIET_TO', String((hora + 2) % 24));
    expect(isQuietHour(base)).toBe(true);

    vi.stubEnv('NUDGE_QUIET_FROM', String((hora + 3) % 24));
    vi.stubEnv('NUDGE_QUIET_TO', String((hora + 5) % 24));
    expect(isQuietHour(base)).toBe(false);
  });

  it('acierta cuando el tramo cruza la medianoche', () => {
    // El caso que rompe la comparación ingenua «desde <= hora < hasta»: a
    // medianoche, con silencio de 23:00 a 01:00, el número de la hora (0) es
    // menor que el de inicio (23) y aun así hay que callar.
    const medianoche = instanteConHoraLocal(0);
    vi.stubEnv('NUDGE_QUIET_FROM', '23');
    vi.stubEnv('NUDGE_QUIET_TO', '1');
    expect(isQuietHour(medianoche)).toBe(true);

    const mediodia = instanteConHoraLocal(12);
    expect(isQuietHour(mediodia)).toBe(false);
  });

  it('se puede desactivar igualando ambos extremos', () => {
    vi.stubEnv('NUDGE_QUIET_FROM', '0');
    vi.stubEnv('NUDGE_QUIET_TO', '0');
    expect(isQuietHour(instanteConHoraLocal(3))).toBe(false);
  });
});

describe('a qué tareas les toca', { sequential: true }, () => {
  let usuarioId;

  async function crearTarea(titulo, prioridad, { creadaHace = '10 hours', ultimoAviso = null } = {}) {
    const db = getDb();
    const fila = await db.prepare(`
      INSERT INTO tasks (user_id, title, priority, created_at, last_nudge_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP - $4::interval, $5)
      RETURNING id
    `).get(usuarioId, titulo, prioridad, creadaHace, ultimoAviso);
    return fila.id;
  }

  it('prepara un usuario con Telegram vinculado', async () => {
    const db = getDb();
    const usuario = await db.prepare(`
      INSERT INTO users (username, full_name, email, password_hash, telefono, telegram_chat_id)
      VALUES ('avisos', 'Usuario Avisos', 'avisos@example.test', 'hash', '+50370000123', 'chat-ficticio')
      RETURNING id
    `).get();
    usuarioId = usuario.id;
    expect(usuarioId).toBeTruthy();
  });

  it('solo trae las que ya cumplieron su intervalo', async () => {
    const db = getDb();
    const urgenteLista = await crearTarea('Urgente vencida', 'urgente', { creadaHace: '3 hours' });
    const urgenteReciente = await crearTarea('Urgente reciente', 'urgente', { creadaHace: '20 minutes' });
    const bajaLista = await crearTarea('Baja vieja', 'baja', { creadaHace: '8 hours' });
    const bajaReciente = await crearTarea('Baja reciente', 'baja', { creadaHace: '2 hours' });

    const pendientes = await getTasksNeedingNudge(db);
    const ids = pendientes.map(t => t.task_id);

    expect(ids).toContain(urgenteLista);
    expect(ids).toContain(bajaLista);
    // Una urgente de hace 20 minutos todavía no cumple su hora.
    expect(ids).not.toContain(urgenteReciente);
    // Una baja de hace 2 horas está lejos de sus 6.
    expect(ids).not.toContain(bajaReciente);
  });

  it('la cuenta arranca al crear la tarea, no en «nunca»', async () => {
    const db = getDb();
    const reciennacida = await crearTarea('Recién creada', 'urgente', { creadaHace: '1 minute' });
    const pendientes = await getTasksNeedingNudge(db);
    expect(pendientes.map(t => t.task_id)).not.toContain(reciennacida);
  });

  it('respeta el último aviso enviado', async () => {
    const db = getDb();
    const id = await crearTarea('Ya avisada', 'urgente', { creadaHace: '10 hours' });

    await markNudgeSent(db, id);
    const trasAvisar = await getTasksNeedingNudge(db);
    expect(trasAvisar.map(t => t.task_id)).not.toContain(id);

    // Simular que pasó la hora: vuelve a tocar.
    await db.prepare(
      "UPDATE tasks SET last_nudge_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1"
    ).run(id);
    const despues = await getTasksNeedingNudge(db);
    expect(despues.map(t => t.task_id)).toContain(id);
  });

  it('solo deja que un runner reclame una tarea elegible', async () => {
    const db = getDb();
    const id = await crearTarea('Una sola vez', 'urgente', { creadaHace: '3 hours' });

    const [primera, segunda] = await Promise.all([
      claimTaskNudge(db, id, 'chat-ficticio'),
      claimTaskNudge(db, id, 'chat-ficticio'),
    ]);

    expect([primera, segunda].filter(Boolean)).toHaveLength(1);
    const claim = primera || segunda;
    expect(claim.task_id).toBe(id);
    expect(claim.claimed_at).toBeTruthy();
  });

  it('revalida estado y chat al reclamar', async () => {
    const db = getDb();
    const completada = await crearTarea('Cambió de estado', 'urgente', { creadaHace: '3 hours' });
    await db.prepare(`
      UPDATE tasks
      SET status = 'completada', completed = TRUE, completed_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `).run(completada);

    expect(await claimTaskNudge(db, completada, 'chat-ficticio')).toBeUndefined();
    expect(await claimTaskNudge(db, completada, 'otro-chat')).toBeUndefined();
  });

  it('libera exactamente su reserva cuando Telegram no confirma', async () => {
    const db = getDb();
    const id = await crearTarea('Reintento seguro', 'urgente', { creadaHace: '3 hours' });
    const claim = await claimTaskNudge(db, id, 'chat-ficticio');

    await releaseTaskNudgeClaim(db, claim);
    const row = await db.prepare('SELECT last_nudge_at FROM tasks WHERE id = $1').get(id);
    expect(row.last_nudge_at).toBeNull();
    expect(await claimTaskNudge(db, id, 'chat-ficticio')).toBeTruthy();
  });

  it('deja en paz las completadas y las archivadas', async () => {
    const db = getDb();
    const completada = await crearTarea('Ya terminada', 'urgente', { creadaHace: '10 hours' });
    const archivada = await crearTarea('Ya archivada', 'urgente', { creadaHace: '10 hours' });
    await db.prepare(
      "UPDATE tasks SET status='completada', completed=TRUE, completed_at=NOW() WHERE id=$1"
    ).run(completada);
    await db.prepare('UPDATE tasks SET archived = TRUE WHERE id = $1').run(archivada);

    const ids = (await getTasksNeedingNudge(db)).map(t => t.task_id);
    expect(ids).not.toContain(completada);
    expect(ids).not.toContain(archivada);
  });

  it('ignora a quien no tiene Telegram vinculado', async () => {
    const db = getDb();
    const otro = await db.prepare(`
      INSERT INTO users (username, full_name, email, password_hash, telefono)
      VALUES ('sinbot', 'Sin Telegram', 'sinbot@example.test', 'hash', '+50370000124')
      RETURNING id
    `).get();
    const suya = await db.prepare(`
      INSERT INTO tasks (user_id, title, priority, created_at)
      VALUES ($1, 'Tarea sin Telegram', 'urgente', CURRENT_TIMESTAMP - INTERVAL '10 hours')
      RETURNING id
    `).get(otro.id);

    const ids = (await getTasksNeedingNudge(db)).map(t => t.task_id);
    expect(ids).not.toContain(suya.id);
  });

  it('no envía nada mientras el interruptor esté apagado', async () => {
    const resultado = await notifyTaskNudges(getDb());
    expect(resultado).toEqual({ sent: 0, skipped: 'desactivado' });
  });

  it('tampoco envía en horas de silencio', async () => {
    vi.stubEnv('TASK_NUDGES_ENABLED', 'true');
    vi.stubEnv('APP_TIME_ZONE', 'UTC');
    // Silencio todo el día para no depender de la hora a la que corran las pruebas.
    vi.stubEnv('NUDGE_QUIET_FROM', '0');
    vi.stubEnv('NUDGE_QUIET_TO', '23');

    const resultado = await notifyTaskNudges(getDb());
    expect(resultado).toEqual({ sent: 0, skipped: 'horas de silencio' });
  });

  it('con el interruptor puesto no marca como avisado lo que no se entregó', async () => {
    vi.stubEnv('TASK_NUDGES_ENABLED', 'true');
    vi.stubEnv('NUDGE_QUIET_FROM', '0');
    vi.stubEnv('NUDGE_QUIET_TO', '0');

    const db = getDb();
    const antes = await getTasksNeedingNudge(db);
    expect(antes.length).toBeGreaterThan(0);

    // Sin TELEGRAM_BOT_TOKEN no hay entrega, así que no debe marcar nada: la
    // tarea sigue pendiente y se reintenta en el siguiente barrido.
    const resultado = await notifyTaskNudges(db);
    expect(resultado.sent).toBe(0);
    expect(resultado.candidates).toBe(antes.length);

    const despues = await getTasksNeedingNudge(db);
    expect(despues.length).toBe(antes.length);
  });
});
