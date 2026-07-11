import { google } from 'googleapis';
import { getUser } from '../../../lib/auth.js';
import { getDb } from '../../../lib/db.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return new Response('No autorizado', { status: 401 });
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return new Response('Google OAuth no configurado.', { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Código de autorización no proporcionado.', { status: 400 });

  const oauth2Client = getOAuthClient();
  const db = getDb();
  const existingUser = db.prepare('SELECT google_refresh_token FROM users WHERE id = ?').get(user.userId);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token || existingUser?.google_refresh_token || null;

    await db.prepare(
      'UPDATE users SET google_access_token = ?, google_refresh_token = ?, google_token_expiry = ? WHERE id = ?'
    ).run(tokens.access_token || null, refreshToken, tokens.expiry_date ? tokens.expiry_date.toString() : null, user.userId);

    return Response.redirect('/dashboard?google=connected');
  } catch (error) {
    console.error('Google callback error:', error);
    return new Response('Error al conectar con Google Calendar.', { status: 500 });
  }
};
