import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/lib/db.js';
import { getDashboardStats } from '../src/lib/dashboardStats.js';

let userId;

let created = 0;

async function createTask({ status = 'pendiente', priority = 'media', label = '', dueDate = null, archived = false }) {
  const completed = status === 'completada';
  created += 1;
  await getDb().prepare(`
    INSERT INTO tasks
      (user_id, title, status, completed, completed_at, priority, label, due_date, archived, archived_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `).run(
    userId,
    `Tarea ficticia ${created}`,
    status,
    completed,
    // El esquema exige que completed y completed_at sean coherentes, igual que
    // archived y archived_at. PostgreSQL sí valida estos contratos.
    completed ? new Date() : null,
    priority,
    label,
    dueDate,
    archived,
    archived ? new Date() : null,
  );
}

beforeAll(async () => {
  const user = await getDb().prepare(`
    INSERT INTO users (username, full_name, email, password_hash, telefono)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `).get('stats', 'Stats Ficticio', 'stats@example.test', '$2b$10$hash-ficticio', '+50370001111');
  userId = user.id;

  await createTask({ status: 'pendiente', label: 'estudio', dueDate: '2020-01-01' });
  await createTask({ status: 'completada', label: 'trabajo' });
  await createTask({ status: 'pendiente', priority: 'urgente', label: 'estudio' });
  await createTask({ status: 'pendiente', dueDate: '2099-01-01' });
  // Archivada: no debe contar en ninguna métrica ni aportar su etiqueta.
  await createTask({ status: 'pendiente', label: 'oculta', archived: true });
});

describe('estadísticas del dashboard', () => {
  it('cuenta solo las tareas no archivadas', async () => {
    const stats = await getDashboardStats(getDb(), userId, '2026-07-25');
    expect(stats.total).toBe(4);
    expect(stats.done).toBe(1);
    expect(stats.active).toBe(3);
    expect(stats.urgent).toBe(1);
  });

  it('devuelve los conteos como números y no como texto', async () => {
    // COUNT(*) es BIGINT: sin el parser de tipos llegaría como string y
    // `total - done` produciría resultados absurdos en la plantilla.
    const stats = await getDashboardStats(getDb(), userId, '2026-07-25');
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.overdue).toBe('number');
  });

  it('considera vencida una tarea según el día que se le pasa', async () => {
    const antes = await getDashboardStats(getDb(), userId, '2019-01-01');
    const despues = await getDashboardStats(getDb(), userId, '2026-07-25');
    expect(antes.overdue).toBe(0);
    expect(despues.overdue).toBe(1);
  });

  it('lista las etiquetas visibles sin incluir las archivadas', async () => {
    const stats = await getDashboardStats(getDb(), userId, '2026-07-25');
    expect(stats.labels).toEqual(['estudio', 'trabajo']);
  });
});
