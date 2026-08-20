import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as jobsHealth } from '../src/pages/api/v1/health/jobs.js';
import { GET as runReminders } from '../src/pages/api/cron/reminders.js';
import { getDb } from '../src/lib/db.js';

// Sonda del estado de los trabajos programados.
//
// Existe por un fallo real: el cron que llama a /api/cron/reminders nunca se
// instaló en el servidor y los recordatorios de Telegram estuvieron meses sin
// ejecutarse sin que nada avisara. /api/v1/health/ready seguía en 200 todo ese
// tiempo, porque comprueba que el servicio responde, no que haga su trabajo.
//
// El síntoma de un trabajo programado muerto es el silencio. Estas pruebas
// fijan que ese silencio produzca una señal.

function contexto() {
  // Sin cabecera Authorization a propósito: es una sonda, igual que
  // /api/v1/health/ready. Si algún día exige credenciales, esto se pone rojo.
  return { request: new Request('http://127.0.0.1:4321/api/v1/health/jobs') };
}

/** Escribe una marca de ejecución con la antigüedad pedida. */
async function marcar({ minutosAtras, ok = true, resumen = {} }) {
  await getDb().prepare(`
    INSERT INTO job_runs (job, last_run_at, last_ok, last_summary)
    VALUES ('cron_reminders', NOW() - ($1::int * INTERVAL '1 minute'), $2, $3::jsonb)
    ON CONFLICT (job) DO UPDATE SET
      last_run_at = EXCLUDED.last_run_at,
      last_ok = EXCLUDED.last_ok,
      last_summary = EXCLUDED.last_summary
  `).run(minutosAtras, ok, JSON.stringify(resumen));
}

async function borrarMarcas() {
  await getDb().prepare('DELETE FROM job_runs').run();
}

afterEach(async () => {
  await borrarMarcas();
  vi.resetModules();
});

describe('sonda de trabajos programados', { sequential: true }, () => {
  it('sin ninguna ejecución registrada responde stale y 503', async () => {
    // EL CASO QUE MOTIVA TODO ESTO. Cero ejecuciones en toda la historia del
    // despliegue era exactamente nuestra situación. Si "nunca ejecutado"
    // diera verde, la sonda reproduciría el fallo que pretende detectar.
    const response = await jobsHealth(contexto());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('stale');
    expect(body.jobs.cron_reminders.stale).toBe(true);
    expect(body.jobs.cron_reminders.reason).toBe('stale');
    expect(body.jobs.cron_reminders.last_run_at).toBeNull();
    expect(body.jobs.cron_reminders.minutes_ago).toBeNull();
    expect(body.jobs.cron_reminders.last_ok).toBeNull();
  });

  it('con una marca reciente responde ok y 200', async () => {
    await marcar({ minutosAtras: 7, resumen: { reminders_sent: 2 } });

    const response = await jobsHealth(contexto());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.jobs.cron_reminders.stale).toBe(false);
    expect(body.jobs.cron_reminders.minutes_ago).toBe(7);
    expect(body.jobs.cron_reminders.expected_every_minutes).toBe(15);
    expect(body.jobs.cron_reminders.last_ok).toBe(true);
    expect(body.jobs.cron_reminders.last_summary).toEqual({ reminders_sent: 2 });
    expect(typeof body.jobs.cron_reminders.last_run_at).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('aguanta dos ciclos perdidos y se queja al tercero', async () => {
    // El umbral son 45 minutos: tres ciclos de 15. Con uno solo, cada reinicio
    // del contenedor dispararía una alerta.
    await marcar({ minutosAtras: 44 });
    expect((await jobsHealth(contexto())).status).toBe(200);

    await marcar({ minutosAtras: 46 });
    const response = await jobsHealth(contexto());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.status).toBe('stale');
    expect(body.jobs.cron_reminders.stale).toBe(true);
    expect(body.jobs.cron_reminders.reason).toBe('stale');
    expect(body.jobs.cron_reminders.minutes_ago).toBeGreaterThanOrEqual(46);
  });

  it('responde 503 cuando el último intento falló, aunque sea reciente', async () => {
    // Un barrido que revienta cada quince minutos tampoco está haciendo su
    // trabajo: los usuarios no reciben nada, igual que si el cron no existiera.
    // Es el mismo fallo que motiva esta sonda, con otra cara, así que una marca
    // fresca no basta para dar verde.
    await marcar({ minutosAtras: 2, ok: false, resumen: { error: 'telegram_no_responde' } });

    const response = await jobsHealth(contexto());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('failing');
    expect(body.jobs.cron_reminders.stale).toBe(false);
    expect(body.jobs.cron_reminders.last_ok).toBe(false);
    expect(body.jobs.cron_reminders.reason).toBe('failing');
    expect(body.jobs.cron_reminders.last_summary).toEqual({ error: 'telegram_no_responde' });
  });

  it('distingue el trabajo que no corre del que corre y peta', async () => {
    // Los dos son 503, pero se investigan de forma distinta: uno se busca en el
    // crontab del servidor y el otro en los logs de la aplicación. Quien lea la
    // alerta tiene que poder decirlo sin abrir nada.
    await marcar({ minutosAtras: 3, ok: true });
    const sano = await (await jobsHealth(contexto())).json();
    expect(sano.jobs.cron_reminders.reason).toBeNull();

    await marcar({ minutosAtras: 60, ok: true });
    const atrasado = await (await jobsHealth(contexto())).json();
    expect(atrasado.status).toBe('stale');
    expect(atrasado.jobs.cron_reminders.reason).toBe('stale');

    // Cuando se dan los dos a la vez manda el que no corre: si lleva una hora
    // sin ejecutarse, que su último intento fallara es historia vieja.
    await marcar({ minutosAtras: 60, ok: false });
    const ambos = await (await jobsHealth(contexto())).json();
    expect(ambos.status).toBe('stale');
    expect(ambos.jobs.cron_reminders.reason).toBe('stale');
  });
});

describe('el barrido deja su marca', { sequential: true }, () => {
  function peticionCron() {
    return new Request('http://127.0.0.1:4321/api/cron/reminders', {
      headers: { Authorization: 'Bearer cron-solo-para-pruebas' },
    });
  }

  async function marcaGuardada() {
    return await getDb()
      .prepare("SELECT * FROM job_runs WHERE job = 'cron_reminders'")
      .get();
  }

  it('registra el barrido exitoso con sus contadores', async () => {
    const response = await runReminders({ request: peticionCron() });
    expect(response.status).toBe(200);

    const marca = await marcaGuardada();
    expect(marca).toBeTruthy();
    expect(marca.last_ok).toBe(true);
    expect(marca.last_summary.reminders_sent).toBe(0);
    expect(marca.last_summary.overdue_alerts).toBe(0);
    expect(Date.now() - new Date(marca.last_run_at).getTime()).toBeLessThan(30_000);
  });

  it('registra también el barrido que reventó', async () => {
    // Sin esto, un cron que falla siempre se vería igual que uno que no existe:
    // la tabla vacía y la sonda diciendo "nunca se ejecutó".
    vi.resetModules();
    vi.doMock('../src/lib/telegramNotify.js', () => ({
      notifyReminders: async () => { throw new Error('telegram no responde'); },
      notifyOverdueTasks: async () => 0,
      notifyTaskNudges: async () => ({ sent: 0, skipped: 0 }),
    }));

    const { GET: cron } = await import('../src/pages/api/cron/reminders.js');
    const { closeDb } = await import('../src/lib/db.js');
    try {
      const response = await cron({ request: peticionCron() });
      expect(response.status).toBe(500);
    } finally {
      // El módulo recargado abre su propio pool; sin cerrarlo la suite queda
      // colgada al terminar.
      await closeDb();
      vi.doUnmock('../src/lib/telegramNotify.js');
    }

    const marca = await marcaGuardada();
    expect(marca).toBeTruthy();
    expect(marca.last_ok).toBe(false);

    const respuesta = await jobsHealth(contexto());
    expect(respuesta.status).toBe(503);
    const body = await respuesta.json();
    expect(body.jobs.cron_reminders.last_ok).toBe(false);
    expect(body.jobs.cron_reminders.reason).toBe('failing');
  });
});
