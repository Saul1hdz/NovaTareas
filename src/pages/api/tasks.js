import { getDb } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { notifyTaskCreated, notifyTaskUrgent } from '../../lib/telegramNotify.js';
import { validateTaskInput } from '../../lib/taskValidation.js';
import { safeErrorSummary } from '../../lib/security.js';

export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });

  const url = new URL(request.url);
  const search   = url.searchParams.get('q')        || '';
  const label    = url.searchParams.get('label')    || '';
  const priority = url.searchParams.get('priority') || '';
  const date     = url.searchParams.get('date')     || '';
  const from     = url.searchParams.get('from')     || '';
  const to       = url.searchParams.get('to')       || '';
  const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
  if (search.length > 200 || label.length > 80) {
    return json({ error: 'Filtro demasiado largo' }, 400);
  }
  if (priority && !['baja', 'media', 'alta', 'urgente'].includes(priority)) {
    return json({ error: 'Prioridad inválida' }, 400);
  }
  for (const value of [date, from, to].filter(Boolean)) {
    const validation = validateTaskInput({ title: 'filtro', due_date: value });
    if (validation.error) return json({ error: validation.error }, 400);
  }
  if (from && to && from > to) {
    return json({ error: 'Rango de fechas inválido' }, 400);
  }

  const db = getDb();
  let query = `SELECT t.*, GROUP_CONCAT(s.id || '::' || s.text || '::' || s.done, '||') as subtasks_raw
    FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id
    WHERE t.user_id=? AND t.archived=?`;
  const params = [user.userId, archived];

  if (search)   { query += ` AND t.title LIKE ?`;              params.push(`%${search}%`); }
  if (label)    { query += ` AND t.label=?`;                   params.push(label); }
  if (priority) { query += ` AND t.priority=?`;                params.push(priority); }
  if (date)     { query += ` AND t.due_date = ?`;              params.push(date); }
  if (from && to) { query += ` AND t.due_date BETWEEN ? AND ?`; params.push(from, to); }

  query += ` GROUP BY t.id ORDER BY
    CASE t.priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 WHEN 'baja' THEN 4 ELSE 5 END,
    t.due_date ASC NULLS LAST, t.created_at DESC`;

  const tasks = db.prepare(query).all(...params);

  const result = tasks.map(t => ({
    ...t,
    subtasks: t.subtasks_raw
      ? t.subtasks_raw.split('||').map(s => {
          const [id, text, done] = s.split('::');
          return { id: Number(id), text, done: Number(done) };
        })
      : []
  }));
  delete result.subtasks_raw;

  return new Response(JSON.stringify(result), { status: 200 });
};

export const POST = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const validation = validateTaskInput(body);
  if (validation.error) return json({ error: validation.error }, 400);
  const {
    title,
    description = '',
    priority = 'media',
    label = '',
    due_date = null,
  } = validation.values;

  const db = getDb();

  // ── Insertar tarea ──────────────────────────────────────────────────────────
  const result = db.prepare(
    'INSERT INTO tasks (user_id, title, description, priority, label, due_date) VALUES (?,?,?,?,?,?)'
  ).run(user.userId, title, description, priority, label, due_date);

  // ── Notificaciones Telegram (solo si el usuario tiene chat vinculado) ───────
  const dbUser = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(user.userId);
  const chatId = dbUser?.telegram_chat_id;

  if (chatId) {
    const task = { title, description, priority, due_date };

    // Notificación de tarea creada
    notifyTaskCreated(chatId, task).catch(err =>
      console.error('[tasks.js] notifyTaskCreated:', safeErrorSummary(err))
    );

    // Si es urgente, enviar también alerta de urgencia
    if (priority === 'urgente') {
      notifyTaskUrgent(chatId, task).catch(err =>
        console.error('[tasks.js] notifyTaskUrgent:', safeErrorSummary(err))
      );
    }
  }

  return json({ id: result.lastInsertRowid }, 201);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
