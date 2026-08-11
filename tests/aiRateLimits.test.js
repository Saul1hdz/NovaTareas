import { beforeAll, describe, expect, it } from 'vitest';
import { createToken } from '../src/lib/auth.js';
import { getDb } from '../src/lib/db.js';
import { POST as recommendTask } from '../src/pages/api/tasks/[id]/ai.js';
import { POST as recommendV1 } from '../src/pages/api/v1/recommend.js';

let userId;
let taskId;
let cookie;

beforeAll(async () => {
  const user = await getDb().prepare(`
    INSERT INTO users (username, full_name, email, password_hash, telefono)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `).get('rate-ai', 'Rate AI', 'rate-ai@example.test', '$2b$10$hash-ficticio', '+503****4444');
  userId = user.id;
  taskId = (await getDb().prepare(`
    INSERT INTO tasks (user_id, title, priority)
    VALUES ($1, $2, $3)
    RETURNING id
  `).get(userId, 'Probar cuota persistente', 'media')).id;
  cookie = `novatareas_token=${await createToken(userId, 'rate-ai', 0)}`;
});

describe('cuotas de IA persistentes', { sequential: true }, () => {
  it('registra la cuota del endpoint autenticado en PostgreSQL', async () => {
    const response = await recommendTask({
      request: new Request(`http://127.0.0.1:4321/api/tasks/${taskId}/ai`, {
        method: 'POST',
        headers: { Cookie: cookie },
      }),
      params: { id: String(taskId) },
    });
    expect(response.status).toBe(200);

    const row = await getDb().prepare(`
      SELECT COUNT(*)::int AS total FROM rate_limit_hits
      WHERE scope = $1 AND subject = $2
    `).get('task-ai-user', String(userId));
    expect(row.total).toBe(1);
  });

  it('registra la cuota de la API externa por IP en PostgreSQL', async () => {
    const ip = '198.51.100.77';
    const response = await recommendV1({
      request: new Request('http://127.0.0.1:4321/api/v1/recommend', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer api-externa-solo-para-pruebas',
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
        },
        body: '{',
      }),
    });
    expect(response.status).toBe(400);

    const row = await getDb().prepare(`
      SELECT COUNT(*)::int AS total FROM rate_limit_hits
      WHERE scope = $1 AND subject = $2
    `).get('api-v1-recommend-ip', ip);
    expect(row.total).toBe(1);
  });
});
