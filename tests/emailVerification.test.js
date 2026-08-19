import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as register } from '../src/pages/api/register.js';
import { POST as login } from '../src/pages/api/login.js';
import { POST as recover } from '../src/pages/api/auth/recover.js';
import { GET as verifyGet, POST as verifyPost } from '../src/pages/api/verify-email.js';
import { getDb } from '../src/lib/db.js';

// El mailer se simula: los tests verifican el flujo de tokens y de base, no el
// envío real por SMTP. Se registran los tokens generados para poder consumirlos.
const sentVerification = [];
const sentReset = [];

vi.mock('../src/lib/mailer.js', () => ({
  emailVerificationRequired: () => true,
  smtpConfigured: () => true,
  appBaseUrl: () => 'http://127.0.0.1:4321',
  sendVerificationEmail: vi.fn(async ({ token }) => {
    sentVerification.push(token);
    return { sent: true };
  }),
  sendPasswordResetEmail: vi.fn(async ({ token }) => {
    sentReset.push(token);
    return { sent: true };
  }),
  sendMail: vi.fn(async () => ({ sent: true })),
  verificationLink: (token) => `http://127.0.0.1:4321/api/verify-email?token=${token}`,
  recoveryLink: (token) => `http://127.0.0.1:4321/?recovery_token=${token}`,
}));

function request(path, method, body) {
  return new Request(`http://127.0.0.1:4321${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function registerUser(email) {
  return register({
    request: request('/api/register', 'POST', {
      full_name: 'Usuario Correo',
      email,
      telefono: '+50361234567',
      password: 'Clave1234',
      user_type: 'estudiante',
      q1_index: 0,
      q1_answer: 'Luna',
      q2_index: 1,
      q2_answer: 'Santa Ana',
    }),
  });
}

async function latestToken() {
  return sentVerification[sentVerification.length - 1];
}

describe('verificación de correo en el registro', { sequential: true }, () => {
  beforeEach(() => {
    sentVerification.length = 0;
    sentReset.length = 0;
  });
  afterEach(() => {
    vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', 'true');
  });

  it('no crea sesión y devuelve pending_verification cuando la política exige confirmar', async () => {
    const response = await registerUser('verifica@example.test');
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.pending_verification).toBe(true);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(sentVerification).toHaveLength(1);
  });

  it('bloquea el login hasta confirmar el correo', async () => {
    await registerUser('verifica2@example.test');
    const response = await login({
      request: request('/api/login', 'POST', {
        email: 'verifica2@example.test',
        password: 'Clave1234',
      }),
    });
    expect(response.status).toBe(403);
  });

  it('consume el token por GET, marca verificado y permite el login', async () => {
    await registerUser('verifica3@example.test');
    const token = await latestToken();

    const redirectResponse = await verifyGet({
      request: new Request(`http://127.0.0.1:4321/api/verify-email?token=${token}`),
      redirect: (url) => ({ redirected: url }),
    });
    expect(redirectResponse.redirected).toBe('/dashboard');

    const db = getDb();
    const user = await db.prepare('SELECT email_verified_at FROM users WHERE email = $1')
      .get('verifica3@example.test');
    expect(user.email_verified_at).not.toBeNull();

    const loginResponse = await login({
      request: request('/api/login', 'POST', {
        email: 'verifica3@example.test',
        password: 'Clave1234',
      }),
    });
    expect(loginResponse.status).toBe(200);
  });

  it('el token es de un solo uso', async () => {
    await registerUser('verifica4@example.test');
    const token = await latestToken();

    await verifyGet({
      request: new Request(`http://127.0.0.1:4321/api/verify-email?token=${token}`),
      redirect: (url) => ({ redirected: url }),
    });
    const second = await verifyPost({
      request: request('/api/verify-email', 'POST', { token }),
    });
    expect(second.status).toBe(400);
  });

  it('rechaza un token inexistente o expirado', async () => {
    const response = await verifyPost({
      request: request('/api/verify-email', 'POST', { token: 'token-que-no-existe' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('recuperación de contraseña por correo', { sequential: true }, () => {
  beforeEach(() => {
    sentVerification.length = 0;
    sentReset.length = 0;
  });

  it('envía un enlace de recuperación cuando la cuenta existe', async () => {
    await registerUser('recupera@example.test');
    const token = await latestToken();
    await verifyGet({
      request: new Request(`http://127.0.0.1:4321/api/verify-email?token=${token}`),
      redirect: (url) => ({ redirected: url }),
    });

    sentReset.length = 0;
    const response = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'request_email_reset',
        email: 'recupera@example.test',
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect(sentReset).toHaveLength(1);
  });

  it('responde genérico cuando el correo no existe (no enumera cuentas)', async () => {
    sentReset.length = 0;
    const response = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'request_email_reset',
        email: 'no-existe@example.test',
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect(sentReset).toHaveLength(0);
  });

  it('permite restablecer la contraseña con el token enviado por correo', async () => {
    await registerUser('recupera2@example.test');
    const verifyToken = await latestToken();
    await verifyGet({
      request: new Request(`http://127.0.0.1:4321/api/verify-email?token=${verifyToken}`),
      redirect: (url) => ({ redirected: url }),
    });

    sentReset.length = 0;
    await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'request_email_reset',
        email: 'recupera2@example.test',
      }),
    });
    const resetToken = sentReset[0];

    const resetResponse = await recover({
      request: request('/api/auth/recover', 'POST', {
        action: 'reset_password',
        token: resetToken,
        new_password: 'NuevaClave99',
      }),
    });
    expect(resetResponse.status).toBe(200);

    const oldLogin = await login({
      request: request('/api/login', 'POST', {
        email: 'recupera2@example.test',
        password: 'Clave1234',
      }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await login({
      request: request('/api/login', 'POST', {
        email: 'recupera2@example.test',
        password: 'NuevaClave99',
      }),
    });
    expect(newLogin.status).toBe(200);
  });
});
