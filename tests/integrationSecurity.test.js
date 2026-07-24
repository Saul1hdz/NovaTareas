import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { GET as runReminders } from '../src/pages/api/cron/reminders.js';
import { POST as telegramWebhook } from '../src/pages/api/telegram/webhook.js';
import { validateAvatarFile } from '../src/lib/avatarValidation.js';

describe('integraciones protegidas', () => {
  it('rechaza cron sin Bearer secret', async () => {
    const response = await runReminders({
      request: new Request('http://localhost:4321/api/cron/reminders'),
    });
    expect(response.status).toBe(401);
  });

  it('rechaza cron con un secreto incorrecto', async () => {
    const response = await runReminders({
      request: new Request('http://localhost:4321/api/cron/reminders', {
        headers: { Authorization: 'Bearer incorrecto' },
      }),
    });
    expect(response.status).toBe(401);
  });

  it('rechaza un webhook falsificado antes de procesar el cuerpo', async () => {
    const response = await telegramWebhook({
      request: new Request('http://localhost:4321/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'incorrecto',
        },
        body: JSON.stringify({ message: { text: '/start' } }),
      }),
    });
    expect(response.status).toBe(401);
  });

  it('rechaza JSON inválido aunque el webhook use el secreto correcto', async () => {
    const response = await telegramWebhook({
      request: new Request('http://localhost:4321/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'telegram-solo-para-pruebas',
        },
        body: '{invalido',
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe('avatares verificados por contenido', () => {
  it('decodifica y normaliza una imagen real a WEBP', async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 124, g: 106, b: 247, alpha: 1 },
      },
    }).png().toBuffer();
    const file = new File([png], 'avatar.png', { type: 'image/png' });

    const result = await validateAvatarFile(file);
    expect(result.error).toBeUndefined();
    expect(result.extension).toBe('webp');
    expect(result.mime).toBe('image/webp');
    expect((await sharp(result.buffer).metadata()).format).toBe('webp');
  });

  it('rechaza contenido falso aunque tenga firma y extensión PNG', async () => {
    const fakePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x6e, 0x6f, 0x2d, 0x65, 0x73, 0x2d, 0x69, 0x6d, 0x61, 0x67, 0x65,
    ]);
    const file = new File([fakePng], 'avatar.png', { type: 'image/png' });

    const result = await validateAvatarFile(file);
    expect(result.error).toMatch(/decodificar/i);
  });

  it('rechaza cuando el MIME declarado no coincide con el contenido', async () => {
    const jpeg = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).jpeg().toBuffer();
    const file = new File([jpeg], 'avatar.png', { type: 'image/png' });

    const result = await validateAvatarFile(file);
    expect(result.error).toMatch(/no coincide/i);
  });
});
