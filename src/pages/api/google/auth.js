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
  if (!user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'Google OAuth no configurado. Agrega GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI.' }), { status: 500 });
  }

  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly']
  });

  return Response.redirect(url);
};
