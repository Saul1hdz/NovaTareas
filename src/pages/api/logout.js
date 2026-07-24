export const prerender = false;

import { clearSessionCookie } from '../../lib/auth.js';

export const POST = async ({ request }) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(request),
    },
  });
};
