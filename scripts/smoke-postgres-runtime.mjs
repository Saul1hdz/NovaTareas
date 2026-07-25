import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { closeDb, getDb } from '../src/lib/db.js';
import { consumeTelegramLinkCode } from '../src/lib/telegramLink.js';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4321';
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const firstEmail = `qa.pg.a.${suffix}@example.test`;
const secondEmail = `qa.pg.b.${suffix}@example.test`;
const password = `Qa${randomBytes(8).toString('hex')}7`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { Accept: 'application/json', Origin: baseUrl };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

async function register(email, fullName) {
  return request('/api/register', {
    method: 'POST',
    body: {
      full_name: fullName,
      email,
      telefono: '+50370000000',
      password,
      user_type: 'estudiante',
      q1_index: 0,
      q1_answer: 'respuesta ficticia uno',
      q2_index: 1,
      q2_answer: 'respuesta ficticia dos',
    },
  });
}

async function login(email) {
  const result = await request('/api/login', {
    method: 'POST',
    body: { email, password },
  });
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  return { ...result, cookie };
}

let taskId;
try {
  const firstRegistration = await register(firstEmail, 'QA PostgreSQL A');
  const secondRegistration = await register(secondEmail, 'QA PostgreSQL B');
  assert(firstRegistration.response.status === 201, 'Falló el registro A.');
  assert(secondRegistration.response.status === 201, 'Falló el registro B.');

  const first = await login(firstEmail);
  const second = await login(secondEmail);
  assert(first.response.status === 200 && first.cookie, 'Falló el login A.');
  assert(second.response.status === 200 && second.cookie, 'Falló el login B.');

  const created = await request('/api/tasks', {
    method: 'POST',
    cookie: first.cookie,
    body: {
      title: 'Tarea ficticia PostgreSQL',
      description: 'Smoke test del Bloque 4',
      priority: 'alta',
      due_date: '2026-08-01',
    },
  });
  taskId = Number(created.data?.id);
  assert(created.response.status === 201 && taskId > 0, 'Falló la creación de tarea.');

  const listed = await request('/api/tasks', { cookie: first.cookie });
  assert(
    listed.response.status === 200
      && listed.data.some((task) => Number(task.id) === taskId),
    'La tarea propia no apareció en el listado.',
  );

  const foreignUpdate = await request(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    cookie: second.cookie,
    body: { title: 'Intento ajeno' },
  });
  assert(foreignUpdate.response.status === 404, 'Falló el aislamiento por ownership.');

  const completed = await request(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    cookie: first.cookie,
    body: { status: 'completada' },
  });
  assert(completed.response.status === 200, 'Falló la actualización transaccional.');

  const history = await request(`/api/tasks/${taskId}/history`, {
    cookie: first.cookie,
  });
  assert(
    history.response.status === 200
      && history.data.history.some((entry) => entry.field === 'Estado'),
    'No se registró el historial de la tarea.',
  );

  const link = await request('/api/telegram/link-code', {
    method: 'POST',
    cookie: first.cookie,
  });
  assert(link.response.status === 201, 'No se generó el código de Telegram.');
  const linked = await consumeTelegramLinkCode(link.data.code, `qa-chat-${suffix}`);
  const reused = await consumeTelegramLinkCode(link.data.code, `qa-reuse-${suffix}`);
  assert(linked?.email === firstEmail, 'No se vinculó Telegram al usuario correcto.');
  assert(reused === null, 'El código de Telegram pudo reutilizarse.');

  console.log(JSON.stringify({
    ok: true,
    engine: 'postgres',
    checks: [
      'registro',
      'hash y login',
      'creación y listado de tareas',
      'ownership entre usuarios',
      'actualización e historial transaccional',
      'código Telegram de un solo uso',
    ],
  }, null, 2));
} finally {
  await getDb().prepare('DELETE FROM users WHERE email IN ($1, $2)').run(
    firstEmail,
    secondEmail,
  ).catch(() => {});
  await closeDb();
}
