export const prerender = false;

import { google } from 'googleapis';
import {
  clearOAuthStateCookie,
  getUser,
  verifyOAuthState,
} from '../../../lib/auth.js';
import { getDb } from '../../../lib/db.js';
import { safeEqualStrings, safeErrorSummary } from '../../../lib/security.js';
import {
  decryptToken,
  encryptToken,
  isTokenEncryptionConfigured,
} from '../../../lib/tokenEncryption.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return text('No autorizado', 401, request);
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return text('Google OAuth no configurado.', 503, request);
  }
  if (!isTokenEncryptionConfigured()) {
    return text('Cifrado de integraciones no configurado.', 503, request);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = readCookie(request, 'oauth_state');
  if (!code || !state || !stateCookie || !safeEqualStrings(state, stateCookie)) {
    return text('Solicitud OAuth inválida.', 400, request);
  }

  const statePayload = await verifyOAuthState(state);
  if (!statePayload || Number(statePayload.userId) !== Number(user.userId)) {
    return text('Solicitud OAuth inválida.', 400, request);
  }

  const db = getDb();
  const existingUser = await db.prepare(
    'SELECT google_refresh_token FROM users WHERE id = ?'
  ).get(user.userId);

  try {
    const { tokens } = await getOAuthClient().getToken(code);
    const existingRefreshToken = existingUser?.google_refresh_token
      ? decryptToken(existingUser.google_refresh_token)
      : null;
    const refreshToken = tokens.refresh_token || existingRefreshToken;

    await db.prepare(`
      UPDATE users
      SET google_access_token = ?, google_refresh_token = ?, google_token_expiry = ?
      WHERE id = ?
    `).run(
      encryptToken(tokens.access_token),
      encryptToken(refreshToken),
      tokens.expiry_date ? String(tokens.expiry_date) : null,
      user.userId
    );

    return new Response(null, {
      status: 303,
      headers: {
        Location: '/dashboard?google=connected',
        'Set-Cookie': clearOAuthStateCookie(request),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[google/callback] Error intercambiando código:', safeErrorSummary(error));
    return text('Error al conectar con Google Calendar.', 500, request);
  }
};

function readCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] || null;
}

function text(message, status, request) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Set-Cookie': clearOAuthStateCookie(request),
      'Cache-Control': 'no-store',
    },
  });
}
