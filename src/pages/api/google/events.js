import { google } from 'googleapis';
import { getUser } from '../../../lib/auth.js';
import { getDb } from '../../../lib/db.js';
import { safeErrorSummary } from '../../../lib/security.js';
import {
  decryptToken,
  encryptToken,
  isTokenEncryptionConfigured,
} from '../../../lib/tokenEncryption.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

async function refreshAccessToken(oauth2Client, refreshToken) {
  try {
    const result = await oauth2Client.refreshToken(refreshToken);
    return result?.credentials || null;
  } catch (error) {
    console.error('Google token refresh failed:', safeErrorSummary(error));
    return null;
  }
}

export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'Google OAuth no configurado.' }), { status: 500 });
  }
  if (!isTokenEncryptionConfigured()) {
    return new Response(JSON.stringify({ error: 'Cifrado de integraciones no configurado.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const record = await db.prepare('SELECT google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = ?').get(user.userId);
  if (!record?.google_refresh_token) {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const oauth2Client = getOAuthClient();
  let accessToken;
  let refreshToken;
  try {
    accessToken = decryptToken(record.google_access_token) || undefined;
    refreshToken = decryptToken(record.google_refresh_token);
  } catch (error) {
    console.error('Google token decryption failed:', safeErrorSummary(error));
    return new Response(JSON.stringify({ error: 'La conexión de Google debe configurarse nuevamente.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: record.google_token_expiry ? Number(record.google_token_expiry) : undefined
  });

  let credentials = oauth2Client.credentials;
  if (!credentials.access_token || (credentials.expiry_date && Date.now() > credentials.expiry_date - 60000)) {
    const refreshed = await refreshAccessToken(oauth2Client, refreshToken);
    if (refreshed) {
      credentials = refreshed;
      oauth2Client.setCredentials(credentials);
      await db.prepare('UPDATE users SET google_access_token = ?, google_token_expiry = ? WHERE id = ?')
        .run(
          encryptToken(credentials.access_token),
          credentials.expiry_date ? credentials.expiry_date.toString() : null,
          user.userId
        );
    }
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    return new Response(JSON.stringify({ error: 'Rango de fechas inválido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const params = {
    timeMin: from ? new Date(`${from}T00:00:00Z`).toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    timeMax: to ? new Date(`${to}T23:59:59Z`).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 200
  };

  try {
    const response = await calendar.events.list({ calendarId: 'primary', ...params });
    const items = response.data.items || [];
    const events = items.map(event => {
      const start = event.start?.date || event.start?.dateTime;
      const end = event.end?.date || event.end?.dateTime;
      return {
        id: event.id,
        summary: event.summary || 'Evento de Google',
        description: event.description || '',
        date: start?.split('T')[0] || start,
        start,
        end,
        calendar: event.organizer?.email || 'Google Calendar'
      };
    });
    return new Response(JSON.stringify(events), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Google events error:', safeErrorSummary(error));
    return new Response(JSON.stringify({ error: 'Error al obtener eventos de Google Calendar.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
