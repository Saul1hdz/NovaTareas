import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('payload de Z.AI', () => {
  it('desactiva el razonamiento para recomendaciones breves', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://prueba:prueba@127.0.0.1:1/novatareas_test');
    vi.stubEnv('ZAI_API_KEY', 'clave-sintetica-de-prueba');

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Empieza por el primer paso.' } }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { callZai } = await import('../src/lib/ai/providers.js');
    const result = await callZai('Recomienda un primer paso.');

    expect(result).toBe('Empieza por el primer paso.');
    expect(fetchMock).toHaveBeenCalledOnce();

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });
});
