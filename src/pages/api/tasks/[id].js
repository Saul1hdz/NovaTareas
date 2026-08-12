import { getDb, withTransaction } from '../../../lib/db.js';
import { getUser } from '../../../lib/auth.js';
import { notifyTaskCompleted, notifyTaskUrgent } from '../../../lib/telegramNotify.js';
import { validateTaskInput } from '../../../lib/taskValidation.js';
import { safeErrorSummary } from '../../../lib/security.js';
import { parseId } from '../../../lib/routeParams.js';
import { defaultReminderFor } from '../../../lib/appTime.js';
import { can, getTaskAccess } from '../../../lib/collaboration.js';

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
async function recordHistory(db, taskId, userId, oldTask, newValues) {
  const stmt = db.prepare(
    `INSERT INTO task_history (task_id, user_id, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5)`
  );

  for (const [field, label] of Object.entries(TRACKED_FIELDS)) {
    if (!(field in newValues)) continue;

    const oldVal = String(oldTask[field] ?? '');
    const newVal = String(newValues[field] ?? '');
    if (oldVal === newVal) continue;

    await stmt.run(taskId, userId, label, oldVal || null, newVal || null);
  }
}

export const PATCH = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const taskId = parseId(params.id);
  if (taskId === null) return json({ error: 'No encontrado' }, 404);

  const db     = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return json({ error: 'No encontrado' }, 404);
  const task = access.task;

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const validation = validateTaskInput(rawBody, { partial: true });
  if (validation.error) return json({ error: validation.error }, 400);
  const body = validation.values;

  // Archivar y cambiar la visibilidad son decisiones del propietario; el resto
  // de campos los puede tocar cualquier colaborador con nivel de edición.
  const ownerOnly = body.archived !== undefined || body.visibility !== undefined;
  if (ownerOnly && !can(access, 'manage')) {
    return json({ error: 'Solo el propietario puede archivar o cambiar la visibilidad' }, 403);
  }
  if (!can(access, 'edit')) {
    return json({ error: 'Tu nivel en esta tarea no permite editarla' }, 403);
  }
  const fields = [];
  const vals   = [];
  // Cada asignación numera su parámetro por la posición real que ocupa. El
  // UPDATE se arma con hasta catorce campos opcionales y el id al final, así
  // que un contador manual desalinearía los valores en silencio.
  const set = (column, value) => {
    vals.push(value);
    fields.push(`${column}=$${vals.length}`);
  };

  // ── Campos editables ────────────────────────────────────────────────────────
  if (body.title       !== undefined) set('title', body.title);
  if (body.description !== undefined) set('description', body.description);
  if (body.priority    !== undefined) set('priority', body.priority);
  if (body.label       !== undefined) set('label', body.label);
  if (body.due_date !== undefined) {
    set('due_date', body.due_date || null);
    // Al mover la fecha, el aviso se reprograma y vuelven a habilitarse ambas
    // notificaciones. Antes solo se reiniciaba `reminder_sent`, así que una
    // tarea vencida y reagendada nunca volvía a avisar de su vencimiento.
    if (body.reminder_at === undefined) {
      set('reminder_at', defaultReminderFor(body.due_date));
    }
    set('reminder_sent', false);
    set('overdue_notified', false);
  }

  if (body.reminder_at !== undefined) {
    set('reminder_at', body.reminder_at);
    set('reminder_sent', false);
  }

  // ── Estado ──────────────────────────────────────────────────────────────────
  if (body.status !== undefined) {
    set('status', body.status);
    if (body.status === 'completada') {
      set('completed', true);
      set('completed_at', new Date());
    }
    // Reabrir tarea: limpiar campos de completado/archivado
    if (body.status === 'pendiente' || body.status === 'en progreso') {
      set('completed', false);
      set('completed_at', null);
      set('reopened_at', new Date());
    }
  }

  // ── Archivar / Desarchivar ──────────────────────────────────────────────────
  if (body.archived !== undefined) {
    set('archived', Boolean(body.archived));
    if (body.archived) {
      set('archived_at', new Date());
    } else {
      // Reabrir: limpiar estado de archivado y restaurar como pendiente
      set('archived_at', null);
      set('reopened_at', new Date());
      set('status', 'pendiente');
      set('completed', false);
      set('completed_at', null);
      set('reminder_sent', false);   // permitir nuevos recordatorios
      set('overdue_notified', false); // y volver a avisar si vuelve a vencer
    }
  }

  // ── Visibilidad (privada / colaborativa) ────────────────────────────────────
  if (body.visibility !== undefined) set('visibility', body.visibility);

  // ── Observaciones al archivar ───────────────────────────────────────────────
  if (body.observations !== undefined) set('observations', body.observations);
  if (body.what_worked  !== undefined) set('what_worked', body.what_worked);
  if (body.what_failed  !== undefined) set('what_failed', body.what_failed);

  // ── Aplicar cambios ─────────────────────────────────────────────────────────
  // ── Registrar historial de cambios ──────────────────────────────────────────
  // Construir objeto de nuevos valores rastreables para comparar
  const trackedChanges = {};
  if (body.title       !== undefined) trackedChanges.title       = body.title;
  if (body.description !== undefined) trackedChanges.description = body.description;
  if (body.priority    !== undefined) trackedChanges.priority    = body.priority;
  if (body.label       !== undefined) trackedChanges.label       = body.label;
  if (body.due_date    !== undefined) trackedChanges.due_date    = body.due_date || null;
  if (body.status      !== undefined) trackedChanges.status      = body.status;
  // Booleano, no 1/0: la columna ya es boolean y `archived` se compara contra
  // el valor almacenado. Mezclar ambas representaciones registraría un cambio
  // de historial falso en cada guardado.
  if (body.archived    !== undefined) trackedChanges.archived    = Boolean(body.archived);

  if (fields.length) {
    await withTransaction(async (tx) => {
      vals.push(taskId);
      await tx.prepare(`UPDATE tasks SET ${fields.join(',')} WHERE id=$${vals.length}`)
        .run(...vals);
      if (Object.keys(trackedChanges).length > 0) {
        await recordHistory(tx, taskId, user.userId, task, trackedChanges);
      }
    }, db);
  }

  // ── Notificaciones Telegram ─────────────────────────────────────────────────
  // El aviso va al propietario de la tarea, no a quien la editó: en una tarea
  // colaborativa quien la completa suele ser otra persona y el dueño es quien
  // necesita enterarse.
  const dbUser = await db.prepare('SELECT telegram_chat_id FROM users WHERE id=$1').get(task.user_id);
  const chatId = dbUser?.telegram_chat_id;

  if (chatId) {
    if (body.status === 'completada' && task.status !== 'completada') {
      const updatedTask = await db.prepare('SELECT * FROM tasks WHERE id=$1').get(taskId);
      notifyTaskCompleted(chatId, updatedTask).catch(err =>
        console.error('[tasks/[id].js] notifyTaskCompleted:', safeErrorSummary(err))
      );
    }
    if (body.priority === 'urgente' && task.priority !== 'urgente') {
      const updatedTask = await db.prepare('SELECT * FROM tasks WHERE id=$1').get(taskId);
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

  const taskId = parseId(params.id);
  if (taskId === null) return json({ error: 'No encontrado' }, 404);

  const db     = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return json({ error: 'No encontrado' }, 404);
  if (!can(access, 'manage')) {
    return json({ error: 'Solo el propietario puede eliminar la tarea' }, 403);
  }

  const result = await db.prepare('DELETE FROM tasks WHERE id=$1 AND user_id=$2')
    .run(taskId, user.userId);
  if (result.rowCount === 0) return json({ error: 'No encontrado' }, 404);
  return json({ ok: true }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
