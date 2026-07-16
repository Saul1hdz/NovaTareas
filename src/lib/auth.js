import './env.js';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

// Ya no hay valor por defecto: si falta SECRET_KEY en el .env, el servidor
// falla al arrancar en vez de firmar tokens con un secreto público conocido.
if (!process.env.SECRET_KEY) {
  throw new Error(
    'SECRET_KEY no está definido en el entorno. Agrégalo a tu .env antes de arrancar el servidor.'
  );
}

const SECRET = new TextEncoder().encode(process.env.SECRET_KEY);

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createToken(userId, username) {
  return new SignJWT({ userId, username })
    .setProtectedHeader({ alg: 'HS256' })
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
  const cookieMatch = cookie.match(/token=([^;]+)/);
  if (cookieMatch) {
    const payload = await verifyToken(cookieMatch[1]);
    if (payload) return payload;
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return verifyToken(bearerMatch[1]);
  }

  return null;
}