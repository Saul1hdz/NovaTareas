import './env.js';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const SECRET = new TextEncoder().encode(
  process.env.SECRET_KEY || 'novatareas-secret-2024'
);

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

export async function getUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/token=([^;]+)/);
  if (!match) return null;
  return verifyToken(match[1]);
}
