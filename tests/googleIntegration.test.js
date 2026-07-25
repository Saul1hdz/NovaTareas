import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const googleMocks = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
  listEvents: vi.fn(),
  refreshToken: vi.fn(),
}));

vi.mock('googleapis', () => {
  class OAuth2 {
    credentials = {};

    generateAuthUrl(options) {
      googleMocks.generateAuthUrl(options);
      return `https://accounts.google.test/oauth?state=${encodeURIComponent(options.state)}`;
    }

    setCredentials(credentials) {
      this.credentials = credentials;
    }

    async refreshToken(token) {
      return googleMocks.refreshToken(token);
    }
  }

  return {
    google: {
      auth: { OAuth2 },
      calendar: vi.fn(() => ({
        events: { list: googleMocks.listEvents },
      })),
    },
  };
});

import { createToken } from '../src/lib/auth.js';
import { getDb } from '../src/lib/db.js';
import { encryptToken, isEncryptedToken } from '../src/lib/tokenEncryption.js';
import { GET as beginGoogleAuth } from '../src/pages/api/google/auth.js';
import { GET as listGoogleEvents } from '../src/pages/api/google/events.js';

let userId;
let cookie;

function authenticatedRequest(path) {
  return new Request(`http://127.0.0.1:4321${path}`, {
    headers: { Cookie: cookie },
  });
}

beforeAll(async () => {
  const db = getDb();
  const user = await db.prepare(`
    INSERT INTO users (username, full_name, email, password_hash, telefono)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `).get(
    'google-ficticio',
    'Google Ficticio',
    'google-ficticio@example.test',
    '$2b$10$hash-ficticio',
    '+50370008888',
  );
  userId = user.id;
  const token = await createToken(userId, 'google-ficticio');
  cookie = `novatareas_token=${token}`;
});

beforeEach(() => {
  vi.clearAllMocks();
  googleMocks.listEvents.mockResolvedValue({ data: { items: [] } });
});

describe('Google Calendar simulado', { sequential: true }, () => {
  it('inicia OAuth con state firmado sin contactar a Google', async () => {
    const response = await beginGoogleAuth({
      request: authenticatedRequest('/api/google/auth'),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('https://accounts.google.test/');
    expect(response.headers.get('set-cookie')).toContain('oauth_state=');
    expect(googleMocks.generateAuthUrl).toHaveBeenCalledOnce();
    expect(googleMocks.generateAuthUrl.mock.calls[0][0].state).toBeTruthy();
  });

  it('descifra credenciales y normaliza eventos de día completo', async () => {
    const db = getDb();
    await db.prepare(`
      UPDATE users
      SET google_access_token = $1, google_refresh_token = $2, google_token_expiry = $3
      WHERE id = $4
    `).run(
      encryptToken('access-ficticio'),
      encryptToken('refresh-ficticio'),
      new Date(Date.now() + 60 * 60 * 1000),
      userId,
    );
    googleMocks.listEvents.mockResolvedValue({
      data: {
        items: [{
          id: 'evento-1',
          summary: 'Evento ficticio',
          description: 'Sin red real',
          start: { date: '2026-08-03' },
          end: { date: '2026-08-04' },
          organizer: { email: 'calendar@example.test' },
        }],
      },
    });

    const response = await listGoogleEvents({
      request: authenticatedRequest('/api/google/events?from=2026-08-01&to=2026-08-31'),
    });
    const events = await response.json();
    expect(response.status).toBe(200);
    expect(events).toEqual([expect.objectContaining({
      id: 'evento-1',
      summary: 'Evento ficticio',
      date: '2026-08-03',
      calendar: 'calendar@example.test',
    })]);
    expect(googleMocks.listEvents).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'primary',
      timeMin: '2026-08-01T00:00:00.000Z',
      timeMax: '2026-08-31T23:59:59.000Z',
    }));
  });

  it('renueva y vuelve a cifrar un access token vencido', async () => {
    const db = getDb();
    await db.prepare(`
      UPDATE users
      SET google_access_token = NULL, google_refresh_token = $1, google_token_expiry = $2
      WHERE id = $3
    `).run(encryptToken('refresh-renovable'), new Date(Date.now() - 1000), userId);
    googleMocks.refreshToken.mockResolvedValue({
      credentials: {
        access_token: 'access-renovado',
        refresh_token: 'refresh-renovable',
        expiry_date: Date.now() + 60 * 60 * 1000,
      },
    });

    const response = await listGoogleEvents({
      request: authenticatedRequest('/api/google/events'),
    });
    expect(response.status).toBe(200);
    expect(googleMocks.refreshToken).toHaveBeenCalledWith('refresh-renovable');
    const stored = (await db.prepare(
      'SELECT google_access_token FROM users WHERE id = $1'
    ).get(userId)).google_access_token;
    expect(isEncryptedToken(stored)).toBe(true);
    expect(stored).not.toContain('access-renovado');
  });

  it('rechaza rangos inválidos antes de consultar el calendario', async () => {
    const response = await listGoogleEvents({
      request: authenticatedRequest('/api/google/events?from=2026-08-31&to=2026-08-01'),
    });
    expect(response.status).toBe(400);
    expect(googleMocks.listEvents).not.toHaveBeenCalled();
  });
});
