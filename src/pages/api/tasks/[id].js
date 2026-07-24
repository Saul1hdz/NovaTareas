import { getDb } from '../../../lib/db.js';
import { getUser } from '../../../lib/auth.js';
import { notifyTaskCompleted, notifyTaskUrgent } from '../../../lib/telegramNotify.js';
import { validateTaskInput } from '../../../lib/taskValidation.js';
import { safeErrorSummary } from '../../../lib/security.js';

// Campos que se rastrean en el historial con etiquetas legibles
const TRACKED_FIELDS = {
  status:      'Estado',
  priority:    'Prioridad',
  due_date:    'Fecha límite',
  title:       'Título',
  description: 'Descripción',
  label:       'Etiqueta',
  archived:    'Archivada',
};

/**
 * Inserta una fila en task_history por cada campo que cambió.
 */
function recordHistory(db, taskId, userId, oldTask, newValues) {
  const stmt = db.prepare(
    `INSERT INTO task_history (task_id, user_id, field, old_value, new_value)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const [field, label] of Object.entries(TRACKED_FIELDS)) {
    if (!(field in newValues)) continue;

    const oldVal = String(oldTask[field] ?? '');
    const newVal = String(newValues[field] ?? '');
    if (oldVal === newVal) continue;

    stmt.run(taskId, userId, label, oldVal || null, newVal || null);
  }
}

export const PATCH = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db   = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(params.id, user.userId);
  if (!task) return json({ error: 'No encontrado' }, 404);

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const validation = validateTaskInput(rawBody, { partial: true });
  if (validation.error) return json({ error: validation.error }, 400);
  const body = validation.values;
  const fields = [];
  const vals   = [];

  // ── Campos editables ────────────────────────────────────────────────────────
  if (body.title       !== undefined) { fields.push('title=?');       vals.push(body.title); }
  if (body.description !== undefined) { fields.push('description=?'); vals.push(body.description); }
  if (body.priority    !== undefined) { fields.push('priority=?');    vals.push(body.priority); }
  if (body.label       !== undefined) { fields.push('label=?');       vals.push(body.label); }
  if (body.due_date    !== undefined) { fields.push('due_date=?');    vals.push(body.due_date || null); }

  // ── Estado ──────────────────────────────────────────────────────────────────
  if (body.status !== undefined) {
    fields.push('status=?'); vals.push(body.status);
    if (body.status === 'completada') {
      fields.push('completed=?');      vals.push(1);
      fields.push('completed_at=?');   vals.push(new Date().toISOString());
    }
    // Reabrir tarea: limpiar campos de completado/archivado
    if (body.status === 'pendiente' || body.status === 'en progreso') {
      fields.push('completed=?');    vals.push(0);
      fields.push('completed_at=?'); vals.push(null);
      fields.push('reopened_at=?');  vals.push(new Date().toISOString());
    }
  }

  // ── Archivar / Desarchivar ──────────────────────────────────────────────────
  if (body.archived !== undefined) {
    fields.push('archived=?'); vals.push(body.archived ? 1 : 0);
    if (body.archived) {
      fields.push('archived_at=?'); vals.push(new Date().toISOString());
    } else {
      // Reabrir: limpiar estado de archivado y restaurar como pendiente
      fields.push('archived_at=?');  vals.push(null);
      fields.push('reopened_at=?');  vals.push(new Date().toISOString());
      fields.push('status=?');       vals.push('pendiente');
      fields.push('completed=?');    vals.push(0);
      fields.push('completed_at=?'); vals.push(null);
      fields.push('reminder_sent=?');vals.push(0);  // permitir nuevos recordatorios
    }
  }

  // ── Observaciones al archivar ───────────────────────────────────────────────
  if (body.observations !== undefined) { fields.push('observations=?'); vals.push(body.observations); }
  if (body.what_worked  !== undefined) { fields.push('what_worked=?');  vals.push(body.what_worked); }
  if (body.what_failed  !== undefined) { fields.push('what_failed=?');  vals.push(body.what_failed); }

  // ── Aplicar cambios ─────────────────────────────────────────────────────────
  if (fields.length) {
    db.prepare(`UPDATE tasks SET ${fields.join(',')} WHERE id=?`).run(...vals, params.id);
  }

  // ── Registrar historial de cambios ──────────────────────────────────────────
  // Construir objeto de nuevos valores rastreables para comparar
  const trackedChanges = {};
  if (body.title       !== undefined) trackedChanges.title       = body.title;
  if (body.description !== undefined) trackedChanges.description = body.description;
  if (body.priority    !== undefined) trackedChanges.priority    = body.priority;
  if (body.label       !== undefined) trackedChanges.label       = body.label;
  if (body.due_date    !== undefined) trackedChanges.due_date    = body.due_date || null;
  if (body.status      !== undefined) trackedChanges.status      = body.status;
  if (body.archived    !== undefined) trackedChanges.archived    = body.archived ? 1 : 0;

  if (Object.keys(trackedChanges).length > 0) {
    recordHistory(db, params.id, user.userId, task, trackedChanges);
  }

  // ── Notificaciones Telegram ─────────────────────────────────────────────────
  const dbUser = db.prepare('SELECT telegram_chat_id FROM users WHERE id=?').get(user.userId);
  const chatId = dbUser?.telegram_chat_id;

  if (chatId) {
    if (body.status === 'completada' && task.status !== 'completada') {
      const updatedTask = db.prepare('SELECT * FROM tasks WHERE id=?').get(params.id);
      notifyTaskCompleted(chatId, updatedTask).catch(err =>
        console.error('[tasks/[id].js] notifyTaskCompleted:', safeErrorSummary(err))
      );
    }
    if (body.priority === 'urgente' && task.priority !== 'urgente') {
      const updatedTask = db.prepare('SELECT * FROM tasks WHERE id=?').get(params.id);
      notifyTaskUrgent(chatId, updatedTask).catch(err =>
        console.error('[tasks/[id].js] notifyTaskUrgent:', safeErrorSummary(err))
      );
    }
  }

  return json({ ok: true }, 200);
};

export const DELETE = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?')
    .run(params.id, user.userId);
  if (result.changes === 0) return json({ error: 'No encontrado' }, 404);
  return json({ ok: true }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
