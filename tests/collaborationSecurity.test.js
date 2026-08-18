import { describe, expect, it } from 'vitest';
import { POST as register } from '../src/pages/api/register.js';
import { POST as login } from '../src/pages/api/login.js';
import { GET as listTasks, POST as createTask } from '../src/pages/api/tasks.js';
import { PATCH as updateTask } from '../src/pages/api/tasks/[id].js';
import { POST as addComment } from '../src/pages/api/tasks/[id]/comments.js';
import { GET as getHistory } from '../src/pages/api/tasks/[id]/history.js';
import { POST as createInvite } from '../src/pages/api/tasks/[id]/invites.js';
import { POST as acceptInvite } from '../src/pages/api/invites/accept.js';
import { getDb } from '../src/lib/db.js';
import { crossSiteRejection } from '../src/lib/csrf.js';

// Pruebas negativas de los cuatro bloqueos que el gate de despliegue levantó
// sobre el modo colaborativo. Cada bloque comprueba que la puerta está cerrada,
// no que el camino feliz siga funcionando: de eso se encarga
// collaboration.test.js.

const ORIGEN = 'http://127.0.0.1:4321';

function request(path, method, body, cookie, headers = {}) {
  const base = { 'Content-Type': 'application/json', ...headers };
  if (cookie) base.Cookie = cookie;
  return new Request(`${ORIGEN}${path}`, {
    method,
    headers: base,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function registerUser(email, name) {
  return register({
    request: request('/api/register', 'POST', {
      full_name: name,
      email,
      telefono: '+50370000000',
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

describe('bloqueos de seguridad del modo colaborativo', { sequential: true }, () => {
  let duena;
  let invitada;
  let tareaId;

  it('prepara una tarea colaborativa con una invitada dentro', async () => {
    expect((await registerUser('duena@example.test', 'Duena Prueba')).status).toBe(201);
    expect((await registerUser('invitada@example.test', 'Invitada Prueba')).status).toBe(201);
    duena = await cookieFor('duena@example.test');
    invitada = await cookieFor('invitada@example.test');

    const creada = await createTask({
      request: request('/api/tasks', 'POST', {
        title: 'Tarea compartida',
        visibility: 'colaborativa',
      }, duena),
    });
    tareaId = Number((await creada.json()).id);

    const invitacion = await createInvite({
      request: request(`/api/tasks/${tareaId}/invites`, 'POST', { role: 'editor' }, duena),
      params: { id: String(tareaId) },
    });
    const { url } = await invitacion.json();
    const token = url.split('/unirse/')[1];

    const aceptada = await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token }, invitada),
    });
    expect(aceptada.status).toBe(200);
  });

  // ── Bloqueo 1: CSRF ───────────────────────────────────────────────────────

  describe('mutaciones de origen cruzado', () => {
    it('rechaza una mutación con cookie de sesión y origen ajeno', () => {
      const peticion = request('/api/invites/accept', 'POST', { token: 'x' },
        'novatareas_token=abc', { Origin: 'http://atacante.example' });
      expect(crossSiteRejection(peticion, peticion.url)).toBe('origen_cruzado');
    });

    it('rechaza una mutación con cookie que no declara ningún origen', () => {
      // Es el hueco que dejaba el chequeo del framework: un cuerpo JSON desde
      // otro sitio no lo frenaba nadie salvo el preflight del navegador.
      const peticion = request('/api/invites/accept', 'POST', { token: 'x' },
        'novatareas_token=abc');
      expect(crossSiteRejection(peticion, peticion.url)).toBe('origen_ausente');
    });

    it('acepta la misma mutación cuando el origen es el propio sitio', () => {
      const peticion = request('/api/invites/accept', 'POST', { token: 'x' },
        'novatareas_token=abc', { Origin: ORIGEN });
      expect(crossSiteRejection(peticion, peticion.url)).toBeNull();
    });

    it('acepta el Referer del propio sitio cuando no hay Origin', () => {
      const peticion = request('/api/tasks', 'POST', { title: 'x' },
        'novatareas_token=abc', { Referer: `${ORIGEN}/dashboard` });
      expect(crossSiteRejection(peticion, peticion.url)).toBeNull();
    });

    it('no estorba a las lecturas ni a los clientes con Bearer', () => {
      const lectura = request('/api/tasks', 'GET', undefined, 'novatareas_token=abc');
      expect(crossSiteRejection(lectura, lectura.url)).toBeNull();

      // La API pública se autentica con cabecera, que el navegador de una
      // víctima no adjunta solo: no es falsificable y no debe exigírsele origen.
      const externa = request('/api/v1/recommend', 'POST', { titulo: 'x' }, null,
        { Authorization: 'Bearer clave-externa' });
      expect(crossSiteRejection(externa, externa.url)).toBeNull();
    });
  });

  // ── Bloqueo 2: privacidad al volver privada ───────────────────────────────

  describe('volver la tarea privada', () => {
    it('deja fuera a los colaboradores existentes', async () => {
      const antes = await getHistory({
        request: request(`/api/tasks/${tareaId}/history`, 'GET', undefined, invitada),
        params: { id: String(tareaId) },
      });
      expect(antes.status).toBe(200);

      const cambio = await updateTask({
        request: request(`/api/tasks/${tareaId}`, 'PATCH', { visibility: 'privada' }, duena),
        params: { id: String(tareaId) },
      });
      expect(cambio.status).toBe(200);

      // La interfaz dice «Privada»; el acceso real tiene que decir lo mismo.
      const despues = await getHistory({
        request: request(`/api/tasks/${tareaId}/history`, 'GET', undefined, invitada),
        params: { id: String(tareaId) },
      });
      expect(despues.status).toBe(404);

      const edicion = await updateTask({
        request: request(`/api/tasks/${tareaId}`, 'PATCH', { title: 'secuestrada' }, invitada),
        params: { id: String(tareaId) },
      });
      expect(edicion.status).toBe(404);
    });

    it('la retira también del listado de la colaboradora', async () => {
      const listado = await listTasks({
        request: request('/api/tasks', 'GET', undefined, invitada),
      });
      const titulos = (await listado.json()).map(t => t.title);
      expect(titulos).not.toContain('Tarea compartida');
    });

    it('revoca los enlaces que seguían vigentes', async () => {
      const vigentes = await getDb().prepare(
        'SELECT COUNT(*)::int AS total FROM task_invites WHERE task_id = $1 AND revoked_at IS NULL'
      ).get(tareaId);
      expect(vigentes.total).toBe(0);
    });

    it('devuelve el acceso al volver a compartirla', async () => {
      await updateTask({
        request: request(`/api/tasks/${tareaId}`, 'PATCH', { visibility: 'colaborativa' }, duena),
        params: { id: String(tareaId) },
      });
      const despues = await getHistory({
        request: request(`/api/tasks/${tareaId}/history`, 'GET', undefined, invitada),
        params: { id: String(tareaId) },
      });
      expect(despues.status).toBe(200);
    });
  });

  // ── Bloqueo 3: aislamiento del contexto de IA ─────────────────────────────

  describe('recomendaciones de IA', () => {
    it('no muestra a un colaborador la recomendación generada para otro', async () => {
      const db = getDb();
      const duenaId = (await db.prepare(
        'SELECT id FROM users WHERE email = $1'
      ).get('duena@example.test')).id;

      // Recomendación de la dueña, derivada de su historial privado.
      await db.prepare(`
        INSERT INTO task_recommendations
          (task_id, user_id, source, input_snapshot, recommendation)
        VALUES ($1, $2, 'rules', '{}'::jsonb, $3)
      `).run(tareaId, duenaId, 'Basado en tus tareas archivadas: terapia de los martes.');

      const suyo = await listTasks({
        request: request('/api/tasks', 'GET', undefined, duena),
      });
      const tareaDuena = (await suyo.json()).find(t => t.id === tareaId);
      expect(tareaDuena.recommendation?.text).toContain('terapia');

      const ajeno = await listTasks({
        request: request('/api/tasks', 'GET', undefined, invitada),
      });
      const tareaInvitada = (await ajeno.json()).find(t => t.id === tareaId);
      expect(tareaInvitada).toBeDefined();
      expect(tareaInvitada.recommendation).toBeNull();
      expect(JSON.stringify(tareaInvitada)).not.toContain('terapia');
    });
  });

  // ── Bloqueo 4: cuota de IA en comentarios ─────────────────────────────────

  describe('cuota de IA en comentarios', () => {
    it('corta con 429 al superar el límite', async () => {
      const limite = Number(process.env.AI_RATE_LIMIT_MAX) || 5;
      let ultima;
      for (let i = 0; i < limite + 2; i += 1) {
        ultima = await addComment({
          request: request(`/api/tasks/${tareaId}/comments`, 'POST', {
            body: `Avance ${i}`,
            ask_ai: true,
          }, invitada),
          params: { id: String(tareaId) },
        });
      }

      expect(ultima.status).toBe(429);
      expect(ultima.headers.get('Retry-After')).toBeTruthy();
      expect((await ultima.json()).error).toMatch(/límite/i);
    });

    it('sigue permitiendo comentar sin IA cuando la cuota se agotó', async () => {
      const respuesta = await addComment({
        request: request(`/api/tasks/${tareaId}/comments`, 'POST', {
          body: 'Comentario sin IA',
          ask_ai: false,
        }, invitada),
        params: { id: String(tareaId) },
      });
      expect(respuesta.status).toBe(201);
    });
  });
});
