// src/pages/api/v1/health.js
export const prerender = false;

const ZAI_API_KEY = process.env.ZAI_API_KEY?.trim();
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:11434';

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

export async function GET() {
  const ollamaUp = await checkOllama();

  const body = {
    status: 'ok',
    service: 'novatareas-ai',
    timestamp: new Date().toISOString(),
    checks: {
      zai_configured: Boolean(ZAI_API_KEY),
      ollama_available: ollamaUp,
      // El servicio SIEMPRE puede responder gracias al fallback de reglas locales,
      // por eso el estado general es "ok" aunque z.ai y Ollama estén caídos.
      fallback_rules: true,
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
