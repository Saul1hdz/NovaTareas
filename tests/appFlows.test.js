import { describe, expect, it } from 'vitest';
import { POST as register } from '../src/pages/api/register.js';
import { POST as login } from '../src/pages/api/login.js';
import { POST as recover } from '../src/pages/api/auth/recover.js';
import { POST as createTelegramLinkCode } from '../src/pages/api/telegram/link-code.js';
import { GET as listTasks, POST as createTask } from '../src/pages/api/tasks.js';
import {
  DELETE as deleteTask,
  PATCH as updateTask,
} from '../src/pages/api/tasks/[id].js';
import { POST as addComment } from '../src/pages/api/tasks/[id]/comments.js';
import { GET as getHistory } from '../src/pages/api/tasks/[id]/history.js';
import { POST as getAiAdvice } from '../src/pages/api/tasks/[id]/ai.js';
import { PATCH as toggleSubtask } from '../src/pages/api/tasks/[id]/subtasks/[subId].js';
import { POST as updateTheme } from '../src/pages/api/theme.js';
import { POST as logout } from '../src/pages/api/logout.js';
import { PUT as updateProfile } from '../src/pages/api/profile.js';
import { getDb } from '../src/lib/db.js';
import { consumeTelegramLinkCode } from '../src/lib/telegramLink.js';

function request(path, method, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return new Request(`http://127.0.0.1:4321${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function registerUser(email, name, answer1, answer2) {
  return register({
    request: request('/api/register', 'POST', {
      full_name: name,
      email,
      telefono: '+50370000000',
      password: 'Clave1234',
      user_type: 'estudiante',
      q1_index: 0,
      q1_answer: answer1,
      q2_index: 1,
      q2_answer: answer2,
    }),
  });
}

async function loginUser(email, password = 'Clave1234') {
  const response = await login({
    request: request('/api/login', 'POST', { email, password }),
  });
  return {
    response,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

describe('flujos locales con base aislada', { sequential: true }, () => {
  let firstCookie;
  let secondCookie;
  let taskId;
  let subtaskId;

  it('registra usuarios y guarda respuestas con hash', async () => {
    const firstRegistration = await registerUser(
      'ana@example.test',
      'Ana Prueba',
      'Luna',
      'Santa Ana'
    );
    const secondRegistration = await registerUser(
      'beto@example.test',
      'Beto Prueba',
      'Sol',
      'San Miguel'
    );
    expect(firstRegistration.status).toBe(201);
    expect(secondRegistration.status).toBe(201);
    expect(firstRegistration.headers.get('set-cookie')).toContain('novatareas_token=');

    const rows = getDb().prepare(
      'SELECT q1_answer, q2_answer FROM security_questions ORDER BY user_id'
    ).all();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.q1_answer.startsWith('$2'))).toBe(true);
    expect(rows.every(row => row.q2_answer.startsWith('$2'))).toBe(true);
  });

  it('no revela si una cuenta existe durante la recuperación', async () => {
    const questionResponse = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'get_question',
        email: 'persona-inexistente@example.test',
      }),
    });
    const question = await questionResponse.json();
    expect(questionResponse.status).toBe(200);
    expect(question.ok).toBe(true);
    expect(question.error).toBeUndefined();

    const answerResponse = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'check_answer',
        email: 'persona-inexistente@example.test',
        answer: 'cualquier respuesta',
        question_index: question.question_index,
      }),
    });
    const answer = await answerResponse.json();
    expect(answerResponse.status).toBe(200);
    expect(answer.message).toBe('Respuesta incorrecta. Intenta con la otra pregunta.');
  });

  it('inicia sesión con cookie protegida', async () => {
    const first = await loginUser('ana@example.test');
    const second = await loginUser('beto@example.test');
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(first.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(second.response.status).toBe(200);
    // Simula una cookie genérica de otro proyecto en localhost. NovaTareas
    // debe usar exclusivamente su cookie con nombre propio.
    firstCookie = `token=otra-aplicacion; ${first.cookie}`;
    secondCookie = second.cookie;
  });

  it('vincula Telegram con código temporal de un solo uso', async () => {
    const response = await createTelegramLinkCode({
      request: request('/api/telegram/link-code', 'POST', undefined, firstCookie),
    });
    const data = await response.json();
    expect(response.status).toBe(201);
    expect(data.command).toBe(`/vincular ${data.code}`);
    expect(data.command).not.toContain('@');
    expect(data.code).toMatch(/^[A-Z0-9_-]{8}$/);

    const stored = getDb().prepare(
      'SELECT code_hash, used_at FROM telegram_link_codes WHERE user_id = 1'
    ).get();
    expect(stored.code_hash).not.toBe(data.code);
    expect(stored.used_at).toBeNull();

    const linked = consumeTelegramLinkCode(data.code, 'chat-ficticio-1');
    expect(linked.email).toBe('ana@example.test');
    expect(consumeTelegramLinkCode(data.code, 'otro-chat')).toBeNull();
    expect(getDb().prepare('SELECT telegram_chat_id FROM users WHERE id = 1').get())
      .toEqual({ telegram_chat_id: 'chat-ficticio-1' });
  });

  it('crea y lista una tarea del usuario autenticado', async () => {
    const created = await createTask({
      request: request('/api/tasks', 'POST', {
        title: 'Tarea ficticia',
        description: 'Solo para pruebas',
        priority: 'media',
        due_date: '2026-08-01',
      }, firstCookie),
    });
    expect(created.status).toBe(201);
    taskId = Number((await created.json()).id);

    const listed = await listTasks({
      request: request('/api/tasks', 'GET', undefined, firstCookie),
    });
    const tasks = await listed.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Tarea ficticia');
  });

  it('impide que otro usuario modifique o elimine la tarea', async () => {
    const update = await updateTask({
      request: request(`/api/tasks/${taskId}`, 'PATCH', {
        title: 'Intento ajeno',
      }, secondCookie),
      params: { id: String(taskId) },
    });
    expect(update.status).toBe(404);

    const deletion = await deleteTask({
      request: request(`/api/tasks/${taskId}`, 'DELETE', undefined, secondCookie),
      params: { id: String(taskId) },
    });
    expect(deletion.status).toBe(404);
    expect(getDb().prepare('SELECT title FROM tasks WHERE id = ?').get(taskId)?.title)
      .toBe('Tarea ficticia');
  });

  it('protege comentarios, historial, IA y subtareas por ownership', async () => {
    subtaskId = Number(getDb().prepare(
      'INSERT INTO subtasks (task_id, text) VALUES (?, ?)'
    ).run(taskId, 'Paso ficticio').lastInsertRowid);

    const foreignContext = {
      request: request(`/api/tasks/${taskId}`, 'POST', {
        body: 'Intento ajeno',
        ask_ai: false,
      }, secondCookie),
      params: { id: String(taskId) },
    };
    expect((await addComment(foreignContext)).status).toBe(404);
    expect((await getHistory({
      request: request(`/api/tasks/${taskId}/history`, 'GET', undefined, secondCookie),
      params: { id: String(taskId) },
    })).status).toBe(404);
    expect((await getAiAdvice({
      request: request(`/api/tasks/${taskId}/ai`, 'POST', undefined, secondCookie),
      params: { id: String(taskId) },
    })).status).toBe(404);
    expect((await toggleSubtask({
      request: request(`/api/tasks/${taskId}/subtasks/${subtaskId}`, 'PATCH', undefined, secondCookie),
      params: { id: String(taskId), subId: String(subtaskId) },
    })).status).toBe(404);

    expect((await toggleSubtask({
      request: request('/api/tasks/999/subtasks/' + subtaskId, 'PATCH', undefined, firstCookie),
      params: { id: '999', subId: String(subtaskId) },
    })).status).toBe(404);
    expect(getDb().prepare('SELECT done FROM subtasks WHERE id = ?').get(subtaskId).done).toBe(0);
  });

  it('rechaza valores externos inválidos antes de escribir', async () => {
    const invalidTheme = await updateTheme({
      request: request('/api/theme', 'POST', { theme: '<script>' }, firstCookie),
    });
    expect(invalidTheme.status).toBe(400);

    const invalidTask = await createTask({
      request: request('/api/tasks', 'POST', {
        title: 'Entrada inválida',
        priority: 'media\" onclick=\"alert(1)',
      }, firstCookie),
    });
    expect(invalidTask.status).toBe(400);
    expect(getDb().prepare(
      'SELECT COUNT(*) AS total FROM tasks WHERE title = ?'
    ).get('Entrada inválida').total).toBe(0);

    const form = new FormData();
    form.set(
      'avatar',
      new File([
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x66, 0x61, 0x6c, 0x73, 0x6f,
        ]),
      ], 'falso.png', { type: 'image/png' })
    );
    const invalidAvatar = await updateProfile({
      request: new Request('http://127.0.0.1:4321/api/profile', {
        method: 'PUT',
        headers: { Cookie: firstCookie },
        body: form,
      }),
    });
    expect(invalidAvatar.status).toBe(400);
    expect(getDb().prepare('SELECT avatar_url FROM users WHERE id = 1').get().avatar_url)
      .toBeNull();
  });

  it('bloquea recuperación sin borrar la cuenta', async () => {
    let question = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'get_question',
        email: 'ana@example.test',
      }),
    });
    let questionData = await question.json();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await recover({
        request: request('/api/auth/recover', 'POST', {
          action: 'check_answer',
          email: 'ana@example.test',
          answer: 'incorrecta',
          question_index: questionData.question_index,
        }),
      });

      if (attempt < 4) {
        questionData = await response.json();
        questionData.question_index = questionData.next_question_index;
      } else {
        expect(response.status).toBe(429);
      }
    }

    expect(getDb().prepare(
      'SELECT COUNT(*) AS total FROM users WHERE email = ?'
    ).get('ana@example.test').total).toBe(1);
  });

  it('usa un token de un solo uso e invalida sesiones anteriores', async () => {
    const questionResponse = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'get_question',
        email: 'beto@example.test',
      }),
    });
    const question = await questionResponse.json();

    const checked = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'check_answer',
        email: 'beto@example.test',
        answer: 'Sol',
        question_index: question.question_index,
      }),
    });
    const { recovery_token: token } = await checked.json();
    expect(token).toBeTruthy();

    const reset = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'reset_password',
        token,
        new_password: 'NuevaClave5678',
      }),
    });
    expect(reset.status).toBe(200);

    const reused = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'reset_password',
        token,
        new_password: 'OtraClave9012',
      }),
    });
    expect(reused.status).toBe(400);

    const oldSession = await listTasks({
      request: request('/api/tasks', 'GET', undefined, secondCookie),
    });
    expect(oldSession.status).toBe(401);

    const newSession = await loginUser('beto@example.test', 'NuevaClave5678');
    expect(newSession.response.status).toBe(200);
  });

  it('actualiza subtareas y conserva comentarios e historial propios', async () => {
    const toggled = await toggleSubtask({
      request: request(`/api/tasks/${taskId}/subtasks/${subtaskId}`, 'PATCH', undefined, firstCookie),
      params: { id: String(taskId), subId: String(subtaskId) },
    });
    expect(toggled.status).toBe(200);
    expect(getDb().prepare('SELECT done FROM subtasks WHERE id = ?').get(subtaskId).done)
      .toBe(1);

    const commentResponse = await addComment({
      request: request(`/api/tasks/${taskId}/comments`, 'POST', {
        body: 'Avance ficticio registrado',
        ask_ai: false,
      }, firstCookie),
      params: { id: String(taskId) },
    });
    expect(commentResponse.status).toBe(201);

    const edited = await updateTask({
      request: request(`/api/tasks/${taskId}`, 'PATCH', {
        title: 'Tarea ficticia editada',
        priority: 'alta',
      }, firstCookie),
      params: { id: String(taskId) },
    });
    expect(edited.status).toBe(200);

    const historyResponse = await getHistory({
      request: request(`/api/tasks/${taskId}/history`, 'GET', undefined, firstCookie),
      params: { id: String(taskId) },
    });
    const data = await historyResponse.json();
    expect(historyResponse.status).toBe(200);
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].body).toBe('Avance ficticio registrado');
    expect(data.history).toHaveLength(2);
  });

  it('completa, reabre, archiva y desarchiva una tarea', async () => {
    const patchTask = async body => updateTask({
      request: request(`/api/tasks/${taskId}`, 'PATCH', body, firstCookie),
      params: { id: String(taskId) },
    });
    const row = () => getDb().prepare(
      'SELECT status, completed, archived, completed_at, archived_at, reopened_at FROM tasks WHERE id = ?'
    ).get(taskId);

    expect((await patchTask({ status: 'completada' })).status).toBe(200);
    expect(row()).toMatchObject({ status: 'completada', completed: 1, archived: 0 });
    expect(row().completed_at).toBeTruthy();

    expect((await patchTask({ status: 'en progreso' })).status).toBe(200);
    expect(row()).toMatchObject({ status: 'en progreso', completed: 0 });
    expect(row().completed_at).toBeNull();
    expect(row().reopened_at).toBeTruthy();

    expect((await patchTask({
      archived: true,
      observations: 'Cierre ficticio',
      what_worked: 'Dividir en pasos',
      what_failed: 'Posponer',
    })).status).toBe(200);
    expect(row()).toMatchObject({ archived: 1, status: 'en progreso' });
    expect(row().archived_at).toBeTruthy();

    const archived = await listTasks({
      request: request('/api/tasks?archived=1', 'GET', undefined, firstCookie),
    });
    expect((await archived.json()).map(task => task.id)).toContain(taskId);

    expect((await patchTask({ archived: false })).status).toBe(200);
    expect(row()).toMatchObject({ archived: 0, status: 'pendiente', completed: 0 });
    expect(row().archived_at).toBeNull();
  });

  it('elimina la tarea y sus relaciones en cascada', async () => {
    const response = await deleteTask({
      request: request(`/api/tasks/${taskId}`, 'DELETE', undefined, firstCookie),
      params: { id: String(taskId) },
    });
    expect(response.status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS total FROM tasks WHERE id = ?').get(taskId).total)
      .toBe(0);
    expect(getDb().prepare('SELECT COUNT(*) AS total FROM subtasks WHERE id = ?').get(subtaskId).total)
      .toBe(0);
    expect(getDb().prepare('SELECT COUNT(*) AS total FROM task_comments WHERE task_id = ?').get(taskId).total)
      .toBe(0);
  });

  it('cambia la contraseña, invalida la sesión y limpia la cookie al salir', async () => {
    const changed = await updateProfile({
      request: request('/api/profile', 'PUT', {
        password: 'PerfilNueva1234',
      }, firstCookie),
    });
    expect(changed.status).toBe(200);
    expect((await changed.json()).reauthenticate).toBe(true);

    const oldSession = await listTasks({
      request: request('/api/tasks', 'GET', undefined, firstCookie),
    });
    expect(oldSession.status).toBe(401);
    expect((await loginUser('ana@example.test')).response.status).toBe(401);
    expect((await loginUser('ana@example.test', 'PerfilNueva1234')).response.status).toBe(200);

    const loggedOut = await logout({
      request: request('/api/logout', 'POST', undefined, firstCookie),
    });
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get('set-cookie')).toContain('novatareas_token=');
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
