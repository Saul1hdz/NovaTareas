import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresRepositories } from '../src/db/postgres/repositories.js';

describe('esquema PostgreSQL objetivo', () => {
  let client;
  let repositories;
  let ownerId;
  let foreignId;
  let ownerTaskId;
  let foreignTaskId;

  beforeAll(async () => {
    client = await PGlite.create();
    const database = drizzle(client);
    await migrate(database, { migrationsFolder: './migrations/postgresql' });
    // La segunda ejecución debe ser idempotente.
    await migrate(database, { migrationsFolder: './migrations/postgresql' });
    repositories = createPostgresRepositories(database);

    const owner = await client.query(`
      INSERT INTO users
        (username, full_name, email, password_hash, telefono)
      VALUES
        ('owner', 'Usuario Propietario', 'owner@example.test', 'hash', '+50370000001')
      RETURNING id
    `);
    const foreign = await client.query(`
      INSERT INTO users
        (username, full_name, email, password_hash, telefono)
      VALUES
        ('foreign', 'Usuario Ajeno', 'foreign@example.test', 'hash', '+50370000002')
      RETURNING id
    `);
    ownerId = owner.rows[0].id;
    foreignId = foreign.rows[0].id;

    const ownerTask = await client.query(`
      INSERT INTO tasks (user_id, title, due_date, reminder_at)
      VALUES ($1, 'Tarea propietaria', DATE '2026-07-30', TIMESTAMPTZ '2026-07-30 15:00:00-06')
      RETURNING id
    `, [ownerId]);
    const foreignTask = await client.query(`
      INSERT INTO tasks (user_id, title)
      VALUES ($1, 'Tarea ajena')
      RETURNING id
    `, [foreignId]);
    ownerTaskId = ownerTask.rows[0].id;
    foreignTaskId = foreignTask.rows[0].id;

    await client.query(`
      INSERT INTO task_comments (task_id, user_id, body)
      VALUES
        ($1, $2, 'Comentario propietario'),
        ($3, $4, 'Comentario ajeno')
    `, [ownerTaskId, ownerId, foreignTaskId, foreignId]);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('crea todas las tablas del diseño y registra la migración una sola vez', async () => {
    const result = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const names = result.rows.map(row => row.tablename);

    expect(names).toEqual(expect.arrayContaining([
      'users',
      'categories',
      'tasks',
      'subtasks',
      'task_history',
      'task_comments',
      'task_embeddings',
      'task_recommendations',
      'telegram_link_codes',
      'rate_limit_hits',
      'recovery_tokens',
      'telegram_sessions',
    ]));

    // Lo que se comprueba es que migrar dos veces no duplique el registro, no
    // que exista un número concreto de migraciones: fijarlo obligaba a editar
    // esta prueba cada vez que se añadía una.
    const esperadas = JSON.parse(
      readFileSync('./migrations/postgresql/meta/_journal.json', 'utf8')
    ).entries.length;
    const migrations = await client.query(
      'SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations'
    );
    expect(migrations.rows[0].count).toBe(esperadas);
  });

  it('usa DATE para vencimiento y TIMESTAMPTZ para recordatorio', async () => {
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'tasks'
        AND column_name IN ('due_date', 'reminder_at')
      ORDER BY column_name
    `);
    expect(result.rows).toEqual([
      { column_name: 'due_date', data_type: 'date' },
      { column_name: 'reminder_at', data_type: 'timestamp with time zone' },
    ]);
  });

  it('impide correos duplicados sin distinguir mayúsculas', async () => {
    await expect(client.query(`
      INSERT INTO users
        (username, full_name, email, password_hash, telefono)
      VALUES
        ('duplicate', 'Duplicado', 'OWNER@EXAMPLE.TEST', 'hash', '+50370000003')
    `)).rejects.toThrow();
  });

  it('rechaza tokens de Google en texto plano', async () => {
    await expect(client.query(
      'UPDATE users SET google_access_token = $1 WHERE id = $2',
      ['token-plano', ownerId]
    )).rejects.toThrow();
  });

  it('mantiene estado y booleano de completado consistentes', async () => {
    await expect(client.query(
      "UPDATE tasks SET completed = true WHERE id = $1",
      [ownerTaskId]
    )).rejects.toThrow();
  });

  it('los repositorios aplican ownership en tareas y comentarios', async () => {
    expect(await repositories.tasks.findOwned(ownerTaskId, ownerId))
      .toMatchObject({ title: 'Tarea propietaria' });
    expect(await repositories.tasks.findOwned(foreignTaskId, ownerId)).toBeNull();

    const ownerComments = await repositories.comments.listOwned(ownerTaskId, ownerId);
    const foreignComments = await repositories.comments.listOwned(foreignTaskId, ownerId);
    expect(ownerComments).toHaveLength(1);
    expect(ownerComments[0].body).toBe('Comentario propietario');
    expect(foreignComments).toHaveLength(0);
  });

  it('dispone de una tabla separada para recomendaciones de IA', async () => {
    const result = await client.query(`
      INSERT INTO task_recommendations
        (task_id, user_id, source, input_snapshot, recommendation)
      VALUES
        ($1, $2, 'rules', '{"priority":"media"}'::jsonb, 'Recomendación ficticia')
      RETURNING source, recommendation
    `, [ownerTaskId, ownerId]);

    expect(result.rows[0]).toEqual({
      source: 'rules',
      recommendation: 'Recomendación ficticia',
    });
  });
});
