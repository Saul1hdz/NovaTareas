// src/pages/api/v1/health.js
export const prerender = false;

// Las variables se leen DENTRO del handler, no al cargar el módulo. Leídas
// arriba, la sonda informaba `false` de claves que estaban puestas y
// funcionando: en dev, este módulo puede evaluarse antes de que el entorno
// termine de poblarse desde `.env`, y una constante congela ese instante. Una
// sonda que miente sobre lo que hay configurado es peor que no tenerla.
function leerEntorno() {
  return {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    zai: process.env.ZAI_API_KEY?.trim(),
    externa: process.env.AI_API_KEY?.trim(),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  };
}

async function checkOllama(ollamaUrl) {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

export async function GET() {
  const entorno = leerEntorno();
  const ollamaUp = await checkOllama(entorno.ollamaUrl);

  const body = {
    status: 'ok',
    service: 'novatareas-ai',
    timestamp: new Date().toISOString(),
    checks: {
      openrouter_configured: Boolean(entorno.openrouter),
      zai_configured: Boolean(entorno.zai),
      external_api_configured: Boolean(entorno.externa),
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
