import './env.js';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

// Ya no hay valor por defecto: si falta SECRET_KEY en el .env, el servidor
// falla al arrancar en vez de firmar tokens con un secreto público conocido.
if (!process.env.SECRET_KEY) {
  throw new Error(
    'SECRET_KEY no está definido en el entorno. Agrégalo a tu .env antes de arrancar el servidor.'
  );
}

const SECRET = new TextEncoder().encode(process.env.SECRET_KEY);
const SESSION_COOKIE_NAME = 'novatareas_token';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createToken(userId, username, sessionVersion = 0) {
  return new SignJWT({ userId, username, sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extrae el token de sesión de dos fuentes posibles:
 *  1. Cookie "token=..." → usado por el dashboard web (navegador).
 *  2. Header "Authorization: Bearer ..." → usado por consumidores externos
 *     de la API (otras apps, scripts, Postman, etc.).
 * La cookie tiene prioridad si ambas están presentes.
 */
export async function getUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const cookieMatch = cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`)
  );
  if (cookieMatch) {
    const payload = await verifyToken(cookieMatch[1]);
    if (payload && await isCurrentSession(payload)) return payload;
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const payload = await verifyToken(bearerMatch[1]);
    if (payload && await isCurrentSession(payload)) return payload;
  }

  return null;
}

async function isCurrentSession(payload) {
  if (!Number.isInteger(payload.userId)) return false;

  try {
    const { getDb } = await import('./db.js');
    const user = await getDb()
      .prepare('SELECT session_version FROM users WHERE id = $1')
      .get(payload.userId);
    return Boolean(user) && Number(user.session_version) === Number(payload.sessionVersion || 0);
  } catch {
    return false;
  }
}

function cookieSecurity(request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  return isHttps || process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

export function createSessionCookie(token, request) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${cookieSecurity(request)}`;
}

export function clearSessionCookie(request) {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurity(request)}`;
}

export async function createOAuthState(userId) {
  return new SignJWT({
    userId,
    nonce: randomBytes(24).toString('base64url'),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('novatareas')
    .setAudience('google-oauth')
    .setExpirationTime('10m')
    .sign(SECRET);
}

export async function verifyOAuthState(state) {
  try {
    const { payload } = await jwtVerify(state, SECRET, {
      issuer: 'novatareas',
      audience: 'google-oauth',
    });
    return payload;
  } catch {
    return null;
  }
}

export function createOAuthStateCookie(state, request) {
  return `oauth_state=${state}; Path=/api/google/callback; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecurity(request)}`;
}

export function clearOAuthStateCookie(request) {
  return `oauth_state=; Path=/api/google/callback; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurity(request)}`;
}
