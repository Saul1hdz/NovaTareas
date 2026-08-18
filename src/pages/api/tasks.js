import { getDb } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { notifyTaskCreated, notifyTaskUrgent } from '../../lib/telegramNotify.js';
import { validateTaskInput } from '../../lib/taskValidation.js';
import { defaultReminderFor } from '../../lib/appTime.js';
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
  const archived = url.searchParams.get('archived') === '1';
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
  const params = [];
  // Cada filtro numera su parámetro por la posición real que ocupa. Los filtros
  // son condicionales y BETWEEN consume dos, así que un contador aparte se
  // desalinearía y compararía contra la columna equivocada sin dar error.
  const placeholder = value => {
    params.push(value);
    return `$${params.length}`;
  };

  // ORDER BY dentro del agregado: sin él el orden de las subtareas no está
  // garantizado y la lista cambiaría entre peticiones idénticas.
  // `subtasks` son las subtareas reales del usuario; la recomendación de IA se
  // trae aparte, de su propia tabla, en lugar de ir mezclada entre ellas.
  // El id del usuario se reutiliza en el JOIN, en el rol y en el conteo de
  // colaboradores, así que se numera una sola vez y se reusa el placeholder.
  const me = placeholder(user.userId);

  let query = `SELECT t.*, STRING_AGG(
       s.id::text || '::' || s.text || '::' ||
       CASE WHEN s.done THEN '1' ELSE '0' END,
       '||' ORDER BY s.id
     ) as subtasks_raw,
     r.recommendation AS recommendation_text,
     r.source         AS recommendation_source,
     COALESCE(mine.role::text, 'propietario') AS my_role,
     (t.user_id = ${me})                      AS is_owner,
     (SELECT COUNT(*)::int FROM task_collaborators c WHERE c.task_id = t.id)
                                              AS collaborator_count
  FROM tasks t
  LEFT JOIN subtasks s ON s.task_id = t.id
  LEFT JOIN LATERAL (
    SELECT recommendation, source
    FROM task_recommendations
    WHERE task_id = t.id AND user_id = ${me}
    ORDER BY created_at DESC
    LIMIT 1
  ) r ON TRUE
  LEFT JOIN task_collaborators mine ON mine.task_id = t.id AND mine.user_id = ${me}
  WHERE (
      t.user_id = ${me}
      OR (mine.user_id IS NOT NULL AND t.visibility = 'colaborativa')
    )
    AND t.archived=${placeholder(archived)}`;

  if (search)   { query += ` AND t.title ILIKE ${placeholder(`%${search}%`)}`; }
  if (label)    { query += ` AND t.label=${placeholder(label)}`; }
  if (priority) { query += ` AND t.priority=${placeholder(priority)}`; }
  if (date)     { query += ` AND t.due_date = ${placeholder(date)}`; }
  if (from && to) {
    query += ` AND t.due_date BETWEEN ${placeholder(from)} AND ${placeholder(to)}`;
  }

  query += ` GROUP BY t.id, r.recommendation, r.source, mine.role ORDER BY
    CASE t.priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 WHEN 'baja' THEN 4 ELSE 5 END,
    t.due_date ASC NULLS LAST, t.created_at DESC`;

  const tasks = await db.prepare(query).all(...params);

  const result = tasks.map(({ subtasks_raw, recommendation_text, recommendation_source, ...t }) => ({
    ...t,
    subtasks: subtasks_raw
      ? subtasks_raw.split('||').map(s => {
          const [id, text, done] = s.split('::');
          return { id: Number(id), text, done: Number(done) };
        })
      : [],
    recommendation: recommendation_text
      ? { text: recommendation_text, source: recommendation_source }
      : null,
  }));

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
    visibility = 'privada',
  } = validation.values;

  // Si no se indica un recordatorio explícito se programa para la mañana del
  // día de vencimiento. Sin esto la columna quedaba siempre nula y el aviso
  // previo al vencimiento no llegaba a dispararse nunca.
  const reminderAt = validation.values.reminder_at !== undefined
    ? validation.values.reminder_at
    : defaultReminderFor(due_date);

  const db = getDb();

  // ── Insertar tarea ──────────────────────────────────────────────────────────
  const created = await db.prepare(
    `INSERT INTO tasks (user_id, title, description, priority, label, due_date, reminder_at, visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, visibility`
  ).get(user.userId, title, description, priority, label, due_date, reminderAt, visibility);

  // ── Notificaciones Telegram (solo si el usuario tiene chat vinculado) ───────
  const dbUser = await db.prepare('SELECT telegram_chat_id FROM users WHERE id = $1').get(user.userId);
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

  return json({ id: created.id, visibility: created.visibility }, 201);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
