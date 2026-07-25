import { beforeAll, describe, expect, it } from 'vitest';
import { createToken } from '../src/lib/auth.js';
import { getDb } from '../src/lib/db.js';
import { POST as askAi } from '../src/pages/api/tasks/[id]/ai.js';
import { GET as listTasks } from '../src/pages/api/tasks.js';

// Sin ZAI_API_KEY y con Ollama apuntando a un puerto cerrado (vitest.config.js),
// el motor cae al último escalón: las reglas locales. Es determinista y no
// consume saldo.

let cookie;
let userId;
let taskId;

function authenticated(path, method = 'GET', params) {
  return {
    request: new Request(`http://127.0.0.1:4321${path}`, {
      method,
      headers: { Cookie: cookie },
    }),
    params,
  };
}

beforeAll(async () => {
  const user = await getDb().prepare(`
    INSERT INTO users (username, full_name, email, password_hash, telefono)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `).get('reco', 'Reco Ficticia', 'reco@example.test', '$2b$10$hash-ficticio', '+50370004444');
  userId = user.id;
  cookie = `novatareas_token=${await createToken(userId, 'reco', 0)}`;

  const task = await getDb().prepare(`
    INSERT INTO tasks (user_id, title, description, priority)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `).get(userId, 'Preparar examen', 'Repasar todo el temario', 'alta');
  taskId = task.id;

  await getDb().prepare(
    'INSERT INTO subtasks (task_id, text) VALUES ($1, $2)'
  ).run(taskId, 'Paso escrito por la persona');
});

describe('recomendaciones de IA separadas de las subtareas', () => {
  it('conserva las subtareas reales del usuario', async () => {
    // Este era el fallo: el endpoint hacía DELETE sobre `subtasks` antes de
    // insertar la recomendación, así que borraba el trabajo del usuario.
    const response = await askAi(authenticated(`/api/tasks/${taskId}/ai`, 'POST', { id: String(taskId) }));
    expect(response.status).toBe(200);

    const subtasks = await getDb().prepare(
      'SELECT text FROM subtasks WHERE task_id = $1'
    ).all(taskId);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].text).toBe('Paso escrito por la persona');
  });

  it('guarda la recomendación en su propia tabla y registra su origen', async () => {
    await askAi(authenticated(`/api/tasks/${taskId}/ai`, 'POST', { id: String(taskId) }));

    const saved = await getDb().prepare(`
      SELECT source, recommendation, prompt_version, input_snapshot
      FROM task_recommendations
      WHERE task_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `).get(taskId);

    expect(saved.source).toBe('rules');
    expect(saved.recommendation.length).toBeGreaterThan(0);
    expect(saved.prompt_version).toBeTruthy();
    expect(saved.input_snapshot.title).toBe('Preparar examen');
  });

  it('devuelve el origen en la respuesta del endpoint', async () => {
    const response = await askAi(authenticated(`/api/tasks/${taskId}/ai`, 'POST', { id: String(taskId) }));
    const body = await response.json();

    expect(body.source).toBe('rules');
    expect(body.recommendation.text).toBeTruthy();
    expect(body.recommendation.source).toBe('rules');
  });

  it('el listado separa subtareas y recomendación', async () => {
    await askAi(authenticated(`/api/tasks/${taskId}/ai`, 'POST', { id: String(taskId) }));

    const response = await listTasks(authenticated('/api/tasks'));
    const [task] = await response.json();

    expect(task.subtasks).toHaveLength(1);
    expect(task.subtasks[0].text).toBe('Paso escrito por la persona');
    expect(task.recommendation.source).toBe('rules');
    expect(task.recommendation.text).toBeTruthy();
  });
});
