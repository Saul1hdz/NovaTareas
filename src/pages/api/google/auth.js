export const prerender = false;

import { google } from 'googleapis';
import {
  createOAuthState,
  createOAuthStateCookie,
  getUser,
} from '../../../lib/auth.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autorizado' }, 401);
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return json({ error: 'Google OAuth no configurado.' }, 503);
  }

  const state = await createOAuthState(user.userId);
  const authorizationUrl = getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl,
      'Set-Cookie': createOAuthStateCookie(state, request),
      'Cache-Control': 'no-store',
    },
  });
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
