import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const userTypeEnum = pgEnum('user_type', [
  'estudiante',
  'empleado',
  'comun',
]);
export const themeEnum = pgEnum('theme', ['light', 'dark']);
export const taskPriorityEnum = pgEnum('task_priority', [
  'baja',
  'media',
  'alta',
  'urgente',
]);
export const taskStatusEnum = pgEnum('task_status', [
  'pendiente',
  'en progreso',
  'completada',
]);
export const recommendationSourceEnum = pgEnum('recommendation_source', [
  'zai',
  'ollama',
  'history',
  'rules',
]);
// Una tarea nace privada. Pasa a `colaborativa` cuando su dueño genera el primer
// enlace de invitación o marca la casilla al crearla.
export const taskVisibilityEnum = pgEnum('task_visibility', [
  'privada',
  'colaborativa',
]);
// El propietario no se guarda como colaborador: es `tasks.user_id`. Estos son
// los niveles que puede conceder a los demás, de menor a mayor.
export const collaboratorRoleEnum = pgEnum('collaborator_role', [
  'lector',
  'comentarista',
  'editor',
]);
export const commentKindEnum = pgEnum('comment_kind', ['comentario', 'idea']);

const identity = (name = 'id') => integer(name)
  .primaryKey()
  .generatedAlwaysAsIdentity();
const auditTimestamp = (name) => timestamp(name, { withTimezone: true })
  .notNull()
  .defaultNow();

export const users = pgTable('users', {
  id: identity(),
  username: varchar('username', { length: 120 }).notNull(),
  fullName: varchar('full_name', { length: 120 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  telefono: varchar('telefono', { length: 30 }).notNull(),
  userType: userTypeEnum('user_type').notNull().default('comun'),
  avatarUrl: text('avatar_url'),
  telegramChatId: varchar('telegram_chat_id', { length: 64 }),
  theme: themeEnum('theme').notNull().default('dark'),
  // Estas columnas almacenan únicamente ciphertext `enc:v1:*`.
  googleAccessToken: text('google_access_token'),
  googleRefreshToken: text('google_refresh_token'),
  googleTokenExpiry: timestamp('google_token_expiry', { withTimezone: true }),
  sessionVersion: integer('session_version').notNull().default(0),
  createdAt: auditTimestamp('created_at'),
  updatedAt: auditTimestamp('updated_at'),
}, (table) => [
  uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
  uniqueIndex('users_telegram_chat_id_unique')
    .on(table.telegramChatId)
    .where(sql`${table.telegramChatId} IS NOT NULL`),
  check(
    'users_username_length',
    sql`char_length(btrim(${table.username})) BETWEEN 1 AND 120`,
  ),
  check(
    'users_full_name_length',
    sql`char_length(btrim(${table.fullName})) BETWEEN 1 AND 120`,
  ),
  check(
    'users_google_access_token_encrypted',
    sql`${table.googleAccessToken} IS NULL OR ${table.googleAccessToken} LIKE 'enc:v1:%'`,
  ),
  check(
    'users_google_refresh_token_encrypted',
    sql`${table.googleRefreshToken} IS NULL OR ${table.googleRefreshToken} LIKE 'enc:v1:%'`,
  ),
]);

export const securityQuestions = pgTable('security_questions', {
  id: identity(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  q1Index: integer('q1_index').notNull(),
  q1Answer: text('q1_answer').notNull(),
  q2Index: integer('q2_index').notNull(),
  q2Answer: text('q2_answer').notNull(),
  recoveryAttempts: integer('recovery_attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('security_questions_user_unique').on(table.userId),
  check('security_questions_q1_range', sql`${table.q1Index} BETWEEN 0 AND 9`),
  check('security_questions_q2_range', sql`${table.q2Index} BETWEEN 0 AND 9`),
  check('security_questions_distinct', sql`${table.q1Index} <> ${table.q2Index}`),
  check('security_questions_attempts_nonnegative', sql`${table.recoveryAttempts} >= 0`),
]);

export const categories = pgTable('categories', {
  id: identity(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  color: varchar('color', { length: 7 }),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  uniqueIndex('categories_user_name_lower_unique')
    .on(table.userId, sql`lower(${table.name})`),
  index('categories_user_id_idx').on(table.userId),
  check(
    'categories_name_length',
    sql`char_length(btrim(${table.name})) BETWEEN 1 AND 80`,
  ),
  check(
    'categories_color_hex',
    sql`${table.color} IS NULL OR ${table.color} ~ '^#[0-9A-Fa-f]{6}$'`,
  ),
]);

export const tasks = pgTable('tasks', {
  id: identity(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id')
    .references(() => categories.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull().default(''),
  priority: taskPriorityEnum('priority').notNull().default('media'),
  status: taskStatusEnum('status').notNull().default('pendiente'),
  label: varchar('label', { length: 80 }).notNull().default(''),
  dueDate: date('due_date'),
  reminderAt: timestamp('reminder_at', { withTimezone: true }),
  completed: boolean('completed').notNull().default(false),
  reminderSent: boolean('reminder_sent').notNull().default(false),
  overdueNotified: boolean('overdue_notified').notNull().default(false),
  archived: boolean('archived').notNull().default(false),
  visibility: taskVisibilityEnum('visibility').notNull().default('privada'),
  observations: text('observations'),
  whatWorked: text('what_worked'),
  whatFailed: text('what_failed'),
  createdAt: auditTimestamp('created_at'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  reopenedAt: timestamp('reopened_at', { withTimezone: true }),
  updatedAt: auditTimestamp('updated_at'),
}, (table) => [
  index('tasks_user_archived_idx').on(table.userId, table.archived),
  index('tasks_user_status_idx').on(table.userId, table.status),
  index('tasks_user_priority_idx').on(table.userId, table.priority),
  index('tasks_user_due_date_idx').on(table.userId, table.dueDate),
  index('tasks_reminder_at_idx').on(table.reminderAt, table.reminderSent),
  index('tasks_category_id_idx').on(table.categoryId),
  check(
    'tasks_title_length',
    sql`char_length(btrim(${table.title})) BETWEEN 1 AND 200`,
  ),
  check('tasks_description_length', sql`char_length(${table.description}) <= 2000`),
  check('tasks_label_length', sql`char_length(${table.label}) <= 80`),
  check(
    'tasks_completed_matches_status',
    sql`${table.completed} = (${table.status} = 'completada')`,
  ),
  check(
    'tasks_completed_at_contract',
    sql`(${table.completed} AND ${table.completedAt} IS NOT NULL) OR (NOT ${table.completed} AND ${table.completedAt} IS NULL)`,
  ),
]);

export const subtasks = pgTable('subtasks', {
  id: identity(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  index('subtasks_task_id_idx').on(table.taskId),
  check(
    'subtasks_text_length',
    sql`char_length(btrim(${table.text})) BETWEEN 1 AND 2000`,
  ),
]);

export const taskHistory = pgTable('task_history', {
  id: identity(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  field: varchar('field', { length: 80 }).notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  changedAt: auditTimestamp('changed_at'),
}, (table) => [
  index('task_history_task_changed_idx').on(table.taskId, table.changedAt),
  index('task_history_user_id_idx').on(table.userId),
]);

export const taskComments = pgTable('task_comments', {
  id: identity(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  // Un comentario es seguimiento; una idea es una propuesta que el equipo puede
  // discutir. Se distinguen para poder filtrarlas en el panel colaborativo.
  kind: commentKindEnum('kind').notNull().default('comentario'),
  aiReply: text('ai_reply'),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  index('task_comments_task_created_idx').on(table.taskId, table.createdAt),
  index('task_comments_user_id_idx').on(table.userId),
  check(
    'task_comments_body_length',
    sql`char_length(btrim(${table.body})) BETWEEN 1 AND 4000`,
  ),
]);

// ─── Modo colaborativo ───────────────────────────────────────────────────────
//
// Quién puede ver y tocar una tarea que no es suya, y por qué enlace entró.

export const taskCollaborators = pgTable('task_collaborators', {
  id: identity(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: collaboratorRoleEnum('role').notNull().default('comentarista'),
  // Si quien invitó borra su cuenta, la colaboración sigue siendo válida.
  invitedBy: integer('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: auditTimestamp('created_at'),
  updatedAt: auditTimestamp('updated_at'),
}, (table) => [
  uniqueIndex('task_collaborators_task_user_unique').on(table.taskId, table.userId),
  index('task_collaborators_user_idx').on(table.userId),
]);

export const taskInvites = pgTable('task_invites', {
  id: identity(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  // Solo el hash: quien lea la base no puede reconstruir el enlace, igual que
  // con los códigos de Telegram y los tokens de recuperación.
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  role: collaboratorRoleEnum('role').notNull().default('comentarista'),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // 0 significa sin límite de usos.
  maxUses: integer('max_uses').notNull().default(0),
  uses: integer('uses').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  uniqueIndex('task_invites_hash_unique').on(table.tokenHash),
  index('task_invites_task_idx').on(table.taskId),
  index('task_invites_expiry_idx').on(table.expiresAt),
  check('task_invites_hash_hex', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check('task_invites_max_uses_nonnegative', sql`${table.maxUses} >= 0`),
  check('task_invites_uses_nonnegative', sql`${table.uses} >= 0`),
]);

export const taskEmbeddings = pgTable('task_embeddings', {
  id: identity(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  vector: jsonb('vector').notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  dimension: integer('dimension').notNull(),
  createdAt: auditTimestamp('created_at'),
  updatedAt: auditTimestamp('updated_at'),
}, (table) => [
  uniqueIndex('task_embeddings_task_unique').on(table.taskId),
  index('task_embeddings_user_id_idx').on(table.userId),
  check('task_embeddings_dimension_positive', sql`${table.dimension} > 0`),
  check('task_embeddings_vector_array', sql`jsonb_typeof(${table.vector}) = 'array'`),
  check(
    'task_embeddings_dimension_matches',
    sql`jsonb_array_length(${table.vector}) = ${table.dimension}`,
  ),
]);

export const taskRecommendations = pgTable('task_recommendations', {
  id: identity(),
  taskId: integer('task_id')
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  source: recommendationSourceEnum('source').notNull(),
  model: varchar('model', { length: 120 }),
  promptVersion: varchar('prompt_version', { length: 80 }),
  inputSnapshot: jsonb('input_snapshot').notNull(),
  recommendation: text('recommendation').notNull(),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  index('task_recommendations_task_created_idx').on(table.taskId, table.createdAt),
  index('task_recommendations_user_created_idx').on(table.userId, table.createdAt),
  check(
    'task_recommendations_text_length',
    sql`char_length(btrim(${table.recommendation})) BETWEEN 1 AND 12000`,
  ),
]);

/**
 * Valoración de una recomendación de IA: el pulgar y, sobre todo, el porqué.
 *
 * Es la señal que faltaba para poder mejorar: hasta ahora el sistema generaba
 * consejos y nadie sabía si servían. Se guarda por usuario y por recomendación
 * concreta —no por tarea— porque cada participante ve la suya, y sobrevive al
 * archivado para alimentar las recomendaciones de tareas parecidas.
 */
export const recommendationFeedback = pgTable('recommendation_feedback', {
  id: identity(),
  recommendationId: integer('recommendation_id')
    .notNull()
    .references(() => taskRecommendations.id, { onDelete: 'cascade' }),
  // Se guarda también la tarea aunque se pueda deducir: las consultas de
  // contexto buscan por tarea archivada y así se evita un JOIN en cada una.
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  useful: boolean('useful').notNull(),
  comment: text('comment').notNull().default(''),
  createdAt: auditTimestamp('created_at'),
  updatedAt: auditTimestamp('updated_at'),
}, (table) => [
  // Una sola valoración por persona y recomendación: volver a valorar corrige
  // la anterior en vez de acumular opiniones contradictorias del mismo usuario.
  uniqueIndex('recommendation_feedback_unique').on(table.recommendationId, table.userId),
  index('recommendation_feedback_task_idx').on(table.taskId, table.createdAt),
  index('recommendation_feedback_user_idx').on(table.userId),
  check(
    'recommendation_feedback_comment_length',
    sql`char_length(${table.comment}) <= 2000`,
  ),
]);

export const telegramLinkCodes = pgTable('telegram_link_codes', {
  id: identity(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  uniqueIndex('telegram_link_codes_hash_unique').on(table.codeHash),
  index('telegram_link_codes_user_id_idx').on(table.userId),
  index('telegram_link_codes_expiry_idx').on(table.expiresAt),
  check(
    'telegram_link_codes_hash_hex',
    sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`,
  ),
]);

// ─── Estado compartido entre procesos ────────────────────────────────────────
//
// Las tres tablas siguientes sustituyen a estructuras que vivían en memoria.
// Mientras la aplicación fue un único proceso local eso no se notaba; en un
// servidor significa que un reinicio o un segundo contenedor rompían la
// recuperación de contraseña, reiniciaban los límites de uso y perdían las
// conversaciones del bot a medias.

export const rateLimitHits = pgTable('rate_limit_hits', {
  id: identity(),
  scope: varchar('scope', { length: 60 }).notNull(),
  subject: varchar('subject', { length: 200 }).notNull(),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  index('rate_limit_hits_lookup_idx').on(table.scope, table.subject, table.createdAt),
]);

export const recoveryTokens = pgTable('recovery_tokens', {
  id: identity(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: auditTimestamp('created_at'),
}, (table) => [
  uniqueIndex('recovery_tokens_hash_unique').on(table.tokenHash),
  index('recovery_tokens_expiry_idx').on(table.expiresAt),
  check(
    'recovery_tokens_hash_hex',
    sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
  ),
]);

export const telegramSessions = pgTable('telegram_sessions', {
  chatId: varchar('chat_id', { length: 64 }).primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  step: varchar('step', { length: 40 }).notNull(),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: auditTimestamp('updated_at'),
}, (table) => [
  index('telegram_sessions_expiry_idx').on(table.expiresAt),
]);

export const postgresSchema = {
  users,
  securityQuestions,
  categories,
  tasks,
  subtasks,
  taskHistory,
  taskComments,
  taskCollaborators,
  taskInvites,
  taskEmbeddings,
  taskRecommendations,
  recommendationFeedback,
  telegramLinkCodes,
  rateLimitHits,
  recoveryTokens,
  telegramSessions,
};
