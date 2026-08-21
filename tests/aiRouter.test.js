import { afterEach, describe, expect, it, vi } from 'vitest';

// El router remoto decide a qué proveedor se le pide el texto: OpenRouter
// primero, z.ai después. Lo que se prueba aquí es el ORDEN y la degradación,
// no el contenido de la respuesta —de eso ya se ocupa aiProviders.test.js—.

const PROMPT = 'Recomienda un primer paso para una tarea ficticia.';

async function loadRouter({ openrouterKey = '', zaiKey = '' } = {}) {
  vi.resetModules();
  vi.stubEnv('OPENROUTER_API_KEY', openrouterKey);
  vi.stubEnv('ZAI_API_KEY', zaiKey);
  return import('../src/lib/ai/providers.js');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const chat = content => jsonResponse({ choices: [{ message: { content } }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('router remoto de IA', { sequential: true }, () => {
  it('pide a OpenRouter antes que a z.ai cuando ambos están configurados', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chat('Respuesta ficticia de OpenRouter.'));
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote, OPENROUTER_MODEL } = await loadRouter({
      openrouterKey: 'or-ficticia',
      zaiKey: 'zai-ficticia',
    });

    await expect(callRemote(PROMPT)).resolves.toEqual({
      text: 'Respuesta ficticia de OpenRouter.',
      source: 'openrouter',
      model: OPENROUTER_MODEL,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('openrouter.ai');
  });

  it('cae a z.ai cuando OpenRouter responde con error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'sin cuota' }, 429))
      .mockResolvedValueOnce(chat('Respuesta ficticia de z.ai.'));
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote, ZAI_MODEL } = await loadRouter({
      openrouterKey: 'or-ficticia',
      zaiKey: 'zai-ficticia',
    });

    await expect(callRemote(PROMPT)).resolves.toEqual({
      text: 'Respuesta ficticia de z.ai.',
      source: 'zai',
      model: ZAI_MODEL,
    });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('openrouter.ai'),
      expect.stringContaining('api.z.ai'),
    ]);
  });

  it('cae a z.ai cuando OpenRouter devuelve un contenido vacío', async () => {
    // Ox Alpha es un modelo de razonamiento: si el límite de tokens se agota
    // razonando, `content` llega vacío con un 200 y hay que seguir la cascada
    // igual que ante un error de red.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(chat('   '))
      .mockResolvedValueOnce(chat('Respuesta ficticia de z.ai.'));
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote } = await loadRouter({
      openrouterKey: 'or-ficticia',
      zaiKey: 'zai-ficticia',
    });

    const result = await callRemote(PROMPT);
    expect(result.source).toBe('zai');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin OPENROUTER_API_KEY no toca OpenRouter y usa z.ai directamente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chat('Respuesta ficticia de z.ai.'));
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote } = await loadRouter({ zaiKey: 'zai-ficticia' });

    const result = await callRemote(PROMPT);
    expect(result.source).toBe('zai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('api.z.ai');
  });

  it('devuelve source nulo cuando no hay ningún proveedor remoto configurado', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote } = await loadRouter();

    await expect(callRemote(PROMPT)).resolves.toEqual({
      text: null,
      source: null,
      model: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deja razonar a Ox Alpha y solo excluye los tokens de razonamiento', async () => {
    // `reasoning: { enabled: false }` devuelve un 400 real: «Reasoning is
    // mandatory for this endpoint and cannot be disabled». Solo `exclude` vale,
    // y como el razonamiento se cobra del presupuesto de la respuesta, el
    // límite de tokens tiene que ser holgado o `content` llega vacío.
    const fetchMock = vi.fn().mockResolvedValue(chat('Respuesta ficticia de OpenRouter.'));
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote } = await loadRouter({ openrouterKey: 'or-ficticia' });

    await callRemote(PROMPT);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ exclude: true });
    expect(body.reasoning.enabled).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThanOrEqual(2000);
  });

  it('no manda la clave de z.ai a OpenRouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chat('Respuesta ficticia de OpenRouter.'));
    vi.stubGlobal('fetch', fetchMock);
    const { callRemote } = await loadRouter({
      openrouterKey: 'or-ficticia',
      zaiKey: 'zai-ficticia',
    });

    await callRemote(PROMPT);
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer or-ficticia');
    expect(JSON.stringify(headers)).not.toContain('zai-ficticia');
  });
});
