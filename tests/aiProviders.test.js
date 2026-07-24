import { afterEach, describe, expect, it, vi } from 'vitest';

const task = {
  title: 'Preparar informe ficticio',
  description: 'Validar el proveedor de IA sin usar la red.',
  priority: 'alta',
  userType: 'empleado',
  dueDate: '2026-08-10',
};

async function loadEngine({ zaiKey = '', ollamaUrl = 'http://ollama.test' } = {}) {
  vi.resetModules();
  vi.stubEnv('ZAI_API_KEY', zaiKey);
  vi.stubEnv('OLLAMA_URL', ollamaUrl);
  return import('../src/lib/aiEngine.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('cascada de proveedores de IA', { sequential: true }, () => {
  it('usa z.ai cuando responde correctamente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Respuesta ficticia de z.ai.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateRecommendation } = await loadEngine({ zaiKey: 'zai-ficticia' });

    await expect(generateRecommendation(task)).resolves.toEqual({
      text: 'Respuesta ficticia de z.ai.',
      source: 'zai',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('api.z.ai');
  });

  it('usa Ollama cuando z.ai no está configurado', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        response: 'Respuesta ficticia de Ollama.',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateRecommendation } = await loadEngine();

    await expect(generateRecommendation(task)).resolves.toEqual({
      text: 'Respuesta ficticia de Ollama.',
      source: 'ollama',
    });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'http://ollama.test/api/tags',
      'http://ollama.test/api/generate',
    ]);
  });

  it('cae a reglas locales cuando no hay servicios disponibles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('red simulada no disponible')));
    const { generateRecommendation } = await loadEngine();

    const result = await generateRecommendation(task);
    expect(result.source).toBe('rules');
    expect(result.text).toContain('Escribe primero los títulos');
  });
});
