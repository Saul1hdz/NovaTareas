import { google } from 'googleapis';
import { getUser } from '../../../lib/auth.js';
import { getDb } from '../../../lib/db.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

async function refreshAccessToken(oauth2Client, refreshToken) {
  try {
    const result = await oauth2Client.refreshToken(refreshToken);
    return result?.credentials || null;
  } catch (error) {
    console.error('Google token refresh failed:', error);
    return null;
  }
}

export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'Google OAuth no configurado.' }), { status: 500 });
  }

  const db = getDb();
  const record = db.prepare('SELECT google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = ?').get(user.userId);
  if (!record?.google_refresh_token) {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: record.google_access_token || undefined,
    refresh_token: record.google_refresh_token,
    expiry_date: record.google_token_expiry ? Number(record.google_token_expiry) : undefined
  });

  let credentials = oauth2Client.credentials;
  if (!credentials.access_token || (credentials.expiry_date && Date.now() > credentials.expiry_date - 60000)) {
    const refreshed = await refreshAccessToken(oauth2Client, record.google_refresh_token);
    if (refreshed) {
      credentials = refreshed;
      oauth2Client.setCredentials(credentials);
      db.prepare('UPDATE users SET google_access_token = ?, google_token_expiry = ? WHERE id = ?')
        .run(credentials.access_token || null, credentials.expiry_date ? credentials.expiry_date.toString() : null, user.userId);
    }
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
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
    console.error('Google events error:', error);
    return new Response(JSON.stringify({ error: 'Error al obtener eventos de Google Calendar.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
