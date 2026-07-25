import { describe, expect, it } from 'vitest';
import {
  toPostgresParameter,
  toPostgresTimestamp,
  transformSqliteSnapshot,
} from '../src/db/migration/sqliteToPostgres.js';

function emptySnapshot(overrides = {}) {
  return {
    users: [],
    security_questions: [],
    categories: [],
    tasks: [],
    subtasks: [],
    task_history: [],
    task_comments: [],
    task_embeddings: [],
    telegram_link_codes: [],
    schema_migrations: [],
    ...overrides,
  };
}

describe('transformación SQLite a PostgreSQL', () => {
  it('distingue epoch en segundos, milisegundos y fecha SQLite UTC', () => {
    expect(toPostgresTimestamp(1_721_817_600, 'seconds').toISOString())
      .toBe('2024-07-24T10:40:00.000Z');
    expect(toPostgresTimestamp(1_721_817_600_000, 'milliseconds').toISOString())
      .toBe('2024-07-24T10:40:00.000Z');
    expect(toPostgresTimestamp('2026-07-24 15:00:00').toISOString())
      .toBe('2026-07-24T15:00:00.000Z');
  });

  it('descarta tokens de Google que no estén cifrados', () => {
    const result = transformSqliteSnapshot(emptySnapshot({
      users: [{
        id: 1,
        username: 'qa',
        full_name: 'QA',
        email: 'qa@example.test',
        password_hash: 'hash',
        telefono: '+50370000000',
        user_type: 'comun',
        avatar_url: null,
        telegram_chat_id: null,
        theme: 'dark',
        google_access_token: 'texto-plano',
        google_refresh_token: 'enc:v1:seguro',
        google_token_expiry: null,
        session_version: 0,
        created_at: '2026-07-24 15:00:00',
      }],
    }));

    expect(result.tables.users[0].google_access_token).toBeNull();
    expect(result.tables.users[0].google_refresh_token).toBe('enc:v1:seguro');
    expect(result.warnings.discardedPlaintextGoogleAccessTokens).toBe(1);
  });

  it('deriva la dimensión del embedding desde el vector', () => {
    const result = transformSqliteSnapshot(emptySnapshot({
      task_embeddings: [{
        id: 1,
        task_id: 2,
        user_id: 3,
        vector: '[0.1,0.2,0.3]',
        model: 'modelo-ficticio',
        created_at: 1_721_817_600,
        updated_at: 1_721_817_600,
      }],
    }));

    expect(result.tables.task_embeddings[0].vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.tables.task_embeddings[0].dimension).toBe(3);
    expect(toPostgresParameter(
      'task_embeddings',
      'vector',
      result.tables.task_embeddings[0].vector,
    )).toBe('[0.1,0.2,0.3]');
  });

  it('normaliza booleanos y conserva DATE sin convertirla a UTC', () => {
    const result = transformSqliteSnapshot(emptySnapshot({
      tasks: [{
        id: 1,
        user_id: 1,
        category_id: null,
        title: 'Tarea ficticia',
        description: '',
        priority: 'media',
        status: 'completada',
        label: '',
        due_date: '2026-07-25',
        reminder_at: null,
        completed: 1,
        reminder_sent: 1,
        overdue_notified: 0,
        archived: 0,
        observations: null,
        what_worked: null,
        what_failed: null,
        created_at: '2026-07-24 15:00:00',
        completed_at: '2026-07-24 16:00:00',
        archived_at: null,
        reopened_at: null,
      }],
    }));

    expect(result.tables.tasks[0]).toMatchObject({
      due_date: '2026-07-25',
      completed: true,
      reminder_sent: true,
      overdue_notified: false,
      archived: false,
    });
  });
});
