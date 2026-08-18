import { createHash, randomBytes } from 'node:crypto';

/**
 * Modo colaborativo: quién puede hacer qué sobre una tarea compartida.
 *
 * El propietario nunca se guarda en `task_collaborators`; es `tasks.user_id`.
 * Aquí se le representa con el rol virtual `propietario`, que es el único que
 * puede archivar, borrar, invitar y cambiar el nivel de los demás.
 */

export const OWNER_ROLE = 'propietario';
export const COLLABORATOR_ROLES = ['lector', 'comentarista', 'editor'];

const ROLE_LEVEL = {
  lector: 1,
  comentarista: 2,
  editor: 3,
  [OWNER_ROLE]: 4,
};

// Nivel mínimo que exige cada acción.
const CAPABILITY_LEVEL = {
  view: 1,     // ver la tarea, su historial y sus comentarios
  comment: 2,  // aportar ideas y comentarios
  edit: 3,     // cambiar título, descripción, prioridad, fecha o estado
  manage: 4,   // archivar, borrar, invitar y administrar colaboradores
};

export const ROLE_LABELS = {
  lector: 'Lector',
  comentarista: 'Comentarista',
  editor: 'Editor',
  [OWNER_ROLE]: 'Propietario',
};

const INVITE_TTL_DAYS_DEFAULT = 7;
const INVITE_TTL_DAYS_MAX = 30;
const INVITE_MAX_USES_MAX = 100;

export function isCollaboratorRole(value) {
  return typeof value === 'string' && COLLABORATOR_ROLES.includes(value);
}

export function roleLevel(role) {
  return ROLE_LEVEL[role] || 0;
}

/**
 * Resuelve el acceso de un usuario a una tarea en una sola consulta.
 * Devuelve `null` cuando la tarea no existe o el usuario no participa en ella,
 * para que las rutas puedan responder 404 sin revelar su existencia.
 */
export async function getTaskAccess(db, taskId, userId) {
  // La visibilidad manda sobre la lista de colaboradores. Sin la condición
  // `t.visibility = 'colaborativa'`, una tarea que el propietario devolvió a
  // privada seguía siendo accesible para quienes ya estaban dentro: la interfaz
  // decía «Privada» y el acceso real no lo era.
  const row = await db.prepare(`
    SELECT t.*, c.role AS collaborator_role
    FROM tasks t
    LEFT JOIN task_collaborators c ON c.task_id = t.id AND c.user_id = $2
    WHERE t.id = $1
      AND (
        t.user_id = $2
        OR (c.user_id IS NOT NULL AND t.visibility = 'colaborativa')
      )
  `).get(taskId, userId);

  if (!row) return null;

  const { collaborator_role, ...task } = row;
  const isOwner = Number(task.user_id) === Number(userId);
  const role = isOwner ? OWNER_ROLE : collaborator_role;

  return { task, role, level: roleLevel(role), isOwner };
}

/**
 * Condición reutilizable: la tarea `t` es propia o compartida con el usuario.
 * El parámetro que se pasa como `userParam` (`$1`, `$3`…) debe ser el id del
 * usuario; se recibe como texto para que cada consulta lo numere según la
 * posición real que ocupe.
 */
export function visibleTaskCondition(userParam, alias = 't') {
  return `(${alias}.user_id = ${userParam} OR (
    ${alias}.visibility = 'colaborativa' AND EXISTS (
      SELECT 1 FROM task_collaborators tc
      WHERE tc.task_id = ${alias}.id AND tc.user_id = ${userParam}
    )
  ))`;
}

export function can(access, capability) {
  const required = CAPABILITY_LEVEL[capability];
  if (!required) return false;
  return Boolean(access) && access.level >= required;
}

/** Propietario y colaboradores de una tarea, en un único listado ordenado. */
export async function listParticipants(db, taskId) {
  return db.prepare(`
    SELECT u.id AS user_id,
           u.full_name,
           u.username,
           u.avatar_url,
           'propietario'::text AS role,
           t.created_at AS joined_at
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = $1
    UNION ALL
    SELECT u.id, u.full_name, u.username, u.avatar_url,
           c.role::text, c.created_at
    FROM task_collaborators c
    JOIN users u ON u.id = c.user_id
    WHERE c.task_id = $1
    ORDER BY joined_at ASC
  `).all(taskId);
}

// ─── Enlaces de invitación ───────────────────────────────────────────────────

/**
 * Genera el token que viaja en el enlace y el hash que se guarda.
 * En la base solo queda el hash: quien lea la tabla no puede reconstruir el
 * enlace, igual que con los códigos de Telegram y los tokens de recuperación.
 */
export function createInviteToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidInviteToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

export function validateInviteInput(body) {
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'El cuerpo debe ser un objeto JSON' };
  }

  const role = body.role === undefined ? 'comentarista' : body.role;
  if (!isCollaboratorRole(role)) return { error: 'Rol inválido' };

  const days = body.expires_in_days === undefined
    ? INVITE_TTL_DAYS_DEFAULT
    : Number(body.expires_in_days);
  if (!Number.isInteger(days) || days < 1 || days > INVITE_TTL_DAYS_MAX) {
    return { error: `La vigencia debe ser un número entero de 1 a ${INVITE_TTL_DAYS_MAX} días` };
  }

  const maxUses = body.max_uses === undefined ? 0 : Number(body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > INVITE_MAX_USES_MAX) {
    return { error: `Los usos deben ser un número entero de 0 a ${INVITE_MAX_USES_MAX} (0 = sin límite)` };
  }

  return { values: { role, expiresInDays: days, maxUses } };
}

export function inviteUrl(request, token) {
  return new URL(`/unirse/${token}`, request.url).toString();
}

/**
 * Vista previa del enlace, sin canjearlo: qué tarea es, de quién y con qué
 * nivel entraría quien lo abra. Solo lectura, para pintar la página de unión.
 */
export async function describeInvite(db, token) {
  if (!isValidInviteToken(token)) return null;

  const invite = await db.prepare(`
    SELECT i.id, i.role, i.expires_at, i.max_uses, i.uses, i.revoked_at,
           t.id AS task_id, t.title, t.description, t.priority, t.due_date,
           t.user_id AS owner_id, u.full_name AS owner_name
    FROM task_invites i
    JOIN tasks t ON t.id = i.task_id
    JOIN users u ON u.id = t.user_id
    WHERE i.token_hash = $1
  `).get(hashInviteToken(token));

  if (!invite) return null;

  const expired = new Date(invite.expires_at).getTime() <= Date.now();
  const exhausted = invite.max_uses > 0 && invite.uses >= invite.max_uses;
  return {
    ...invite,
    expired,
    exhausted,
    usable: !invite.revoked_at && !expired && !exhausted,
  };
}

/**
 * Canjea un enlace y deja al usuario dentro de la tarea.
 *
 * Todo ocurre en una transacción con la fila del enlace bloqueada: sin el
 * `FOR UPDATE`, dos personas que abren el mismo enlace a la vez leerían el
 * mismo contador de usos y ambas entrarían aunque solo quedara un cupo.
 */
export async function redeemInvite(db, withTransaction, token, userId) {
  if (!isValidInviteToken(token)) {
    return { error: 'El enlace de invitación no es válido', status: 404 };
  }

  return withTransaction(async (tx) => {
    const invite = await tx.prepare(`
      SELECT i.*, t.user_id AS owner_id, t.title
      FROM task_invites i
      JOIN tasks t ON t.id = i.task_id
      WHERE i.token_hash = $1
      FOR UPDATE OF i
    `).get(hashInviteToken(token));

    if (!invite) {
      return { error: 'El enlace de invitación no es válido', status: 404 };
    }
    if (invite.revoked_at) {
      return { error: 'Este enlace fue revocado por el propietario', status: 410 };
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return { error: 'Este enlace ya expiró', status: 410 };
    }
    if (invite.max_uses > 0 && invite.uses >= invite.max_uses) {
      return { error: 'Este enlace alcanzó su número máximo de usos', status: 410 };
    }

    if (Number(invite.owner_id) === Number(userId)) {
      return {
        taskId: invite.task_id,
        title: invite.title,
        role: OWNER_ROLE,
        alreadyMember: true,
      };
    }

    const existing = await tx.prepare(
      'SELECT role FROM task_collaborators WHERE task_id = $1 AND user_id = $2'
    ).get(invite.task_id, userId);

    // Un enlace de menor nivel no degrada a quien ya colabora con más permisos.
    if (existing && roleLevel(existing.role) >= roleLevel(invite.role)) {
      return {
        taskId: invite.task_id,
        title: invite.title,
        role: existing.role,
        alreadyMember: true,
      };
    }

    await tx.prepare(`
      INSERT INTO task_collaborators (task_id, user_id, role, invited_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (task_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, updated_at = NOW()
    `).run(invite.task_id, userId, invite.role, invite.created_by);

    await tx.prepare(
      'UPDATE task_invites SET uses = uses + 1 WHERE id = $1'
    ).run(invite.id);

    // El enlace pudo crearse antes de que la tarea cambiara de estado; al entrar
    // alguien la tarea deja de ser privada en cualquier caso.
    await tx.prepare(
      "UPDATE tasks SET visibility = 'colaborativa' WHERE id = $1"
    ).run(invite.task_id);

    return {
      taskId: invite.task_id,
      title: invite.title,
      role: invite.role,
      alreadyMember: Boolean(existing),
    };
  }, db);
}
