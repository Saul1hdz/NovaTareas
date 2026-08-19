import { describe, expect, it } from 'vitest';
import { POST as register } from '../src/pages/api/register.js';
import { POST as login } from '../src/pages/api/login.js';
import { GET as listTasks, POST as createTask } from '../src/pages/api/tasks.js';
import { DELETE as deleteTask, PATCH as updateTask } from '../src/pages/api/tasks/[id].js';
import { POST as addComment } from '../src/pages/api/tasks/[id]/comments.js';
import { GET as getHistory } from '../src/pages/api/tasks/[id]/history.js';
import {
  DELETE as revokeAllInvites,
  GET as listInvites,
  POST as createInvite,
} from '../src/pages/api/tasks/[id]/invites.js';
import { DELETE as revokeInvite } from '../src/pages/api/tasks/[id]/invites/[inviteId].js';
import { GET as listCollaborators } from '../src/pages/api/tasks/[id]/collaborators.js';
import {
  DELETE as removeCollaborator,
  PATCH as changeRole,
} from '../src/pages/api/tasks/[id]/collaborators/[userId].js';
import { POST as acceptInvite } from '../src/pages/api/invites/accept.js';
import { getDb } from '../src/lib/db.js';

// Modo colaborativo de extremo a extremo: la tarea nace privada, el propietario
// genera un enlace, otra persona lo canjea y a partir de ahí cada acción se
// permite o se rechaza según el nivel que tenga en esa tarea.

function request(path, method, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return new Request(`http://127.0.0.1:4321${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function registerUser(email, name) {
  return register({
    request: request('/api/register', 'POST', {
      full_name: name,
      email,
      telefono: '+50361234567',
      password: 'Clave1234',
      user_type: 'estudiante',
      q1_index: 0,
      q1_answer: 'Luna',
      q2_index: 1,
      q2_answer: 'Santa Ana',
    }),
  });
}

async function cookieFor(email) {
  const response = await login({
    request: request('/api/login', 'POST', { email, password: 'Clave1234' }),
  });
  return response.headers.get('set-cookie')?.split(';')[0];
}

function tokenFromUrl(url) {
  return url.split('/unirse/')[1];
}

describe('modo colaborativo', { sequential: true }, () => {
  let ana;
  let beto;
  let carla;
  let betoId;
  let taskId;
  let inviteToken;

  it('registra a los tres participantes de la prueba', async () => {
    expect((await registerUser('ana@example.test', 'Ana Prueba')).status).toBe(201);
    expect((await registerUser('beto@example.test', 'Beto Prueba')).status).toBe(201);
    expect((await registerUser('carla@example.test', 'Carla Prueba')).status).toBe(201);

    ana = await cookieFor('ana@example.test');
    beto = await cookieFor('beto@example.test');
    carla = await cookieFor('carla@example.test');
    betoId = (await getDb().prepare('SELECT id FROM users WHERE email = $1')
      .get('beto@example.test')).id;
  });

  it('crea la tarea como privada y nadie más la ve', async () => {
    const created = await createTask({
      request: request('/api/tasks', 'POST', {
        title: 'Proyecto compartido',
        description: 'Tarea de la prueba de colaboración',
      }, ana),
    });
    const data = await created.json();
    expect(created.status).toBe(201);
    expect(data.visibility).toBe('privada');
    taskId = Number(data.id);

    const foreign = await getHistory({
      request: request(`/api/tasks/${taskId}/history`, 'GET', undefined, beto),
      params: { id: String(taskId) },
    });
    expect(foreign.status).toBe(404);
  });

  it('solo el propietario genera enlaces de invitación', async () => {
    const ajeno = await createInvite({
      request: request(`/api/tasks/${taskId}/invites`, 'POST', {}, beto),
      params: { id: String(taskId) },
    });
    expect(ajeno.status).toBe(404);

    const response = await createInvite({
      request: request(`/api/tasks/${taskId}/invites`, 'POST', {
        role: 'comentarista',
        expires_in_days: 7,
      }, ana),
      params: { id: String(taskId) },
    });
    const data = await response.json();
    expect(response.status).toBe(201);
    expect(data.url).toContain('/unirse/');
    expect(data.visibility).toBe('colaborativa');
    inviteToken = tokenFromUrl(data.url);

    // En la base solo queda el hash: el enlace no se puede reconstruir leyéndola.
    const stored = await getDb().prepare(
      'SELECT token_hash FROM task_invites WHERE task_id = $1'
    ).get(taskId);
    expect(stored.token_hash).not.toContain(inviteToken);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza enlaces inexistentes y exige sesión iniciada', async () => {
    const anonimo = await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token: inviteToken }),
    });
    expect(anonimo.status).toBe(401);

    const inventado = await acceptInvite({
      request: request('/api/invites/accept', 'POST', {
        token: 'token-inventado-que-no-existe',
      }, beto),
    });
    expect(inventado.status).toBe(404);
  });

  it('deja entrar a quien abre el enlace con el nivel indicado', async () => {
    const response = await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token: inviteToken }, beto),
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.role).toBe('comentarista');
    expect(data.task_id).toBe(taskId);

    const listed = await listTasks({
      request: request('/api/tasks', 'GET', undefined, beto),
    });
    const tasks = await listed.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Proyecto compartido');
    expect(tasks[0].my_role).toBe('comentarista');
    expect(tasks[0].is_owner).toBe(false);
    expect(tasks[0].collaborator_count).toBe(1);
  });

  it('un comentarista aporta ideas pero no edita la tarea', async () => {
    const comment = await addComment({
      request: request(`/api/tasks/${taskId}/comments`, 'POST', {
        body: 'Propongo dividir el trabajo en dos bloques',
        kind: 'idea',
        ask_ai: false,
      }, beto),
      params: { id: String(taskId) },
    });
    const commentData = await comment.json();
    expect(comment.status).toBe(201);
    expect(commentData.kind).toBe('idea');
    expect(commentData.author_name).toBe('Beto Prueba');

    const edit = await updateTask({
      request: request(`/api/tasks/${taskId}`, 'PATCH', { title: 'Renombrada' }, beto),
      params: { id: String(taskId) },
    });
    expect(edit.status).toBe(403);

    const removal = await deleteTask({
      request: request(`/api/tasks/${taskId}`, 'DELETE', undefined, beto),
      params: { id: String(taskId) },
    });
    expect(removal.status).toBe(403);

    expect((await getDb().prepare('SELECT title FROM tasks WHERE id = $1').get(taskId)).title)
      .toBe('Proyecto compartido');
  });

  it('el historial muestra quién aportó cada cosa', async () => {
    const response = await getHistory({
      request: request(`/api/tasks/${taskId}/history`, 'GET', undefined, beto),
      params: { id: String(taskId) },
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.my_role).toBe('comentarista');
    expect(data.is_owner).toBe(false);
    expect(data.comments[0].author_name).toBe('Beto Prueba');
    expect(data.participants.map(p => p.role)).toEqual(['propietario', 'comentarista']);
  });

  it('el propietario sube el nivel y entonces sí puede editar', async () => {
    const ascenso = await changeRole({
      request: request(`/api/tasks/${taskId}/collaborators/${betoId}`, 'PATCH', {
        role: 'editor',
      }, ana),
      params: { id: String(taskId), userId: String(betoId) },
    });
    expect(ascenso.status).toBe(200);

    const edit = await updateTask({
      request: request(`/api/tasks/${taskId}`, 'PATCH', {
        title: 'Proyecto compartido v2',
      }, beto),
      params: { id: String(taskId) },
    });
    expect(edit.status).toBe(200);

    // Un editor sigue sin poder archivar ni borrar: eso es del propietario.
    const archivar = await updateTask({
      request: request(`/api/tasks/${taskId}`, 'PATCH', { archived: true }, beto),
      params: { id: String(taskId) },
    });
    expect(archivar.status).toBe(403);

    const history = await getHistory({
      request: request(`/api/tasks/${taskId}/history`, 'GET', undefined, ana),
      params: { id: String(taskId) },
    });
    const data = await history.json();
    expect(data.history.at(-1).author_name).toBe('Beto Prueba');
  });

  it('un colaborador no puede ascenderse a sí mismo ni administrar el equipo', async () => {
    const intento = await changeRole({
      request: request(`/api/tasks/${taskId}/collaborators/${betoId}`, 'PATCH', {
        role: 'editor',
      }, beto),
      params: { id: String(taskId), userId: String(betoId) },
    });
    expect(intento.status).toBe(403);

    const invitar = await createInvite({
      request: request(`/api/tasks/${taskId}/invites`, 'POST', {}, beto),
      params: { id: String(taskId) },
    });
    expect(invitar.status).toBe(403);
  });

  it('respeta el número máximo de usos del enlace', async () => {
    const created = await createInvite({
      request: request(`/api/tasks/${taskId}/invites`, 'POST', {
        role: 'lector',
        max_uses: 1,
      }, ana),
      params: { id: String(taskId) },
    });
    const token = tokenFromUrl((await created.json()).url);

    expect((await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token }, carla),
    })).status).toBe(200);

    // El cupo ya se consumió: nadie más entra con ese enlace.
    await getDb().prepare(
      'DELETE FROM task_collaborators WHERE task_id = $1 AND user_id = $2'
    ).run(taskId, (await getDb().prepare('SELECT id FROM users WHERE email = $1')
      .get('carla@example.test')).id);

    const agotado = await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token }, carla),
    });
    expect(agotado.status).toBe(410);
    expect((await agotado.json()).error).toContain('máximo de usos');
  });

  it('un enlace revocado deja de funcionar', async () => {
    const created = await createInvite({
      request: request(`/api/tasks/${taskId}/invites`, 'POST', { role: 'lector' }, ana),
      params: { id: String(taskId) },
    });
    const { url, invite } = await created.json();

    const revocado = await revokeInvite({
      request: request(`/api/tasks/${taskId}/invites/${invite.id}`, 'DELETE', undefined, ana),
      params: { id: String(taskId), inviteId: String(invite.id) },
    });
    expect(revocado.status).toBe(200);

    const intento = await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token: tokenFromUrl(url) }, carla),
    });
    expect(intento.status).toBe(410);

    // Revocar en bloque deja la lista sin enlaces activos.
    await revokeAllInvites({
      request: request(`/api/tasks/${taskId}/invites`, 'DELETE', undefined, ana),
      params: { id: String(taskId) },
    });
    const listed = await listInvites({
      request: request(`/api/tasks/${taskId}/invites`, 'GET', undefined, ana),
      params: { id: String(taskId) },
    });
    const { invites } = await listed.json();
    expect(invites.every(item => !item.active)).toBe(true);
  });

  it('quitar a un colaborador le retira el acceso por completo', async () => {
    const equipo = await listCollaborators({
      request: request(`/api/tasks/${taskId}/collaborators`, 'GET', undefined, beto),
      params: { id: String(taskId) },
    });
    expect(equipo.status).toBe(200);

    const removal = await removeCollaborator({
      request: request(`/api/tasks/${taskId}/collaborators/${betoId}`, 'DELETE', undefined, ana),
      params: { id: String(taskId), userId: String(betoId) },
    });
    expect(removal.status).toBe(200);

    const despues = await getHistory({
      request: request(`/api/tasks/${taskId}/history`, 'GET', undefined, beto),
      params: { id: String(taskId) },
    });
    expect(despues.status).toBe(404);

    const listed = await listTasks({
      request: request('/api/tasks', 'GET', undefined, beto),
    });
    expect(await listed.json()).toHaveLength(0);
  });
});
