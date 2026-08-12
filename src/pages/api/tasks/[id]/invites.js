import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { parseId } from '../../../../lib/routeParams.js';
import { consumeRateLimit } from '../../../../lib/security.js';
import {
  can,
  createInviteToken,
  getTaskAccess,
  inviteUrl,
  validateInviteInput,
} from '../../../../lib/collaboration.js';

// Un enlace de invitación da acceso a datos personales del propietario, así que
// generarlos también tiene cuota: sin ella, una sesión robada podría fabricar
// cientos de enlaces indetectables.
const INVITE_RATE_MAX = Number(process.env.INVITE_RATE_LIMIT_MAX) || 20;
const INVITE_RATE_WINDOW = 60 * 60 * 1000;

export const GET = async ({ request, params }) => {
  const context = await requireOwner(request, params);
  if (context.response) return context.response;
  const { db, taskId } = context;

  const invites = await db.prepare(`
    SELECT id, role, expires_at, max_uses, uses, revoked_at, created_at
    FROM task_invites
    WHERE task_id = $1
    ORDER BY created_at DESC
  `).all(taskId);

  // El token no se puede devolver: solo existe su hash. La interfaz muestra el
  // enlace completo una única vez, cuando se crea.
  return json({ invites: invites.map(describeInvite) }, 200);
};

export const POST = async ({ request, params }) => {
  const context = await requireOwner(request, params);
  if (context.response) return context.response;
  const { db, taskId, user } = context;

  let rawBody = {};
  if (request.headers.get('content-type')?.includes('application/json')) {
    try {
      rawBody = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }
  }

  const validation = validateInviteInput(rawBody);
  if (validation.error) return json({ error: validation.error }, 400);
  const { role, expiresInDays, maxUses } = validation.values;

  const limit = await consumeRateLimit(
    'task-invite-user',
    String(user.userId),
    INVITE_RATE_MAX,
    INVITE_RATE_WINDOW,
  );
  if (!limit.allowed) {
    return json(
      { error: `Límite de ${INVITE_RATE_MAX} enlaces por hora alcanzado.` },
      429,
      { 'Retry-After': String(limit.retryAfterSeconds) },
    );
  }

  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const created = await db.prepare(`
    INSERT INTO task_invites (task_id, token_hash, role, created_by, expires_at, max_uses)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, role, expires_at, max_uses, uses, revoked_at, created_at
  `).get(taskId, tokenHash, role, user.userId, expiresAt, maxUses);

  // Compartir la tarea deja de tener sentido si sigue marcada como privada.
  await db.prepare(
    "UPDATE tasks SET visibility = 'colaborativa' WHERE id = $1"
  ).run(taskId);

  return json({
    invite: describeInvite(created),
    url: inviteUrl(request, token),
    visibility: 'colaborativa',
  }, 201);
};

export const DELETE = async ({ request, params }) => {
  const context = await requireOwner(request, params);
  if (context.response) return context.response;
  const { db, taskId } = context;

  const result = await db.prepare(`
    UPDATE task_invites SET revoked_at = NOW()
    WHERE task_id = $1 AND revoked_at IS NULL
  `).run(taskId);

  return json({ ok: true, revoked: result.rowCount }, 200);
};

async function requireOwner(request, params) {
  const user = await getUser(request);
  if (!user) return { response: json({ error: 'No autenticado' }, 401) };

  const taskId = parseId(params.id);
  if (taskId === null) return { response: json({ error: 'No encontrado' }, 404) };

  const db = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return { response: json({ error: 'No encontrado' }, 404) };
  if (!can(access, 'manage')) {
    return {
      response: json({ error: 'Solo el propietario puede administrar las invitaciones' }, 403),
    };
  }

  return { db, taskId, user, access };
}

function describeInvite(invite) {
  const expired = new Date(invite.expires_at).getTime() <= Date.now();
  const exhausted = invite.max_uses > 0 && invite.uses >= invite.max_uses;
  return {
    ...invite,
    active: !invite.revoked_at && !expired && !exhausted,
    expired,
    exhausted,
  };
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}
