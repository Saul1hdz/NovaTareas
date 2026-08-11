import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as register } from '../src/pages/api/register.js';

function request(ip) {
  return new Request('http://127.0.0.1:4321/api/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: '{',
  });
}

describe('protecciones del registro público', { sequential: true }, () => {
  afterEach(() => vi.stubEnv('REGISTRATION_ENABLED', 'true'));

  it('rechaza el registro cuando no está habilitado explícitamente', async () => {
    vi.stubEnv('REGISTRATION_ENABLED', 'false');
    const response = await register({ request: request('198.51.100.20') });
    expect(response.status).toBe(403);
  });

  it('limita solicitudes por IP antes del trabajo costoso', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 100) + 100}`;
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await register({ request: request(ip) }));
    }
    expect(responses.slice(0, 10).every(response => response.status === 400)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(responses[10].headers.get('Retry-After')).toBeTruthy();
  });
});
