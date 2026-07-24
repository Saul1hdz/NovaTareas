import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de los endpoints de la API v1.
//
// Equivale al patrón `TestClient` de FastAPI: en lugar de levantar el servidor
// con `npm run dev` y lanzar peticiones con curl, se importa el handler del
// endpoint y se le pasa un objeto Request directamente. Así las pruebas son
// rápidas, repetibles y no necesitan un puerto abierto.
// ─────────────────────────────────────────────────────────────────────────────

import { GET as healthGET }     from '../src/pages/api/v1/health.js';
import { GET as metadataGET }   from '../src/pages/api/v1/metadata.js';
import { POST as recommendPOST, GET as recommendGET } from '../src/pages/api/v1/recommend.js';

/** Construye un contexto de petición similar al que entrega Astro. */
function makeContext(body, ip = '127.0.0.1', apiKey = 'api-externa-solo-para-pruebas') {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return {
    request: new Request('http://localhost:4321/api/v1/recommend', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    clientAddress: ip,
  };
}

describe('GET /api/v1/health', () => {
  it('responde 200 con status ok', async () => {
    const response = await healthGET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('novatareas-ai');
  });

  it('informa el estado de sus dependencias', async () => {
    const response = await healthGET();
    const data = await response.json();

    expect(data.checks).toBeDefined();
    expect(typeof data.checks.zai_configured).toBe('boolean');
    expect(typeof data.checks.ollama_available).toBe('boolean');
    // El fallback local garantiza que el servicio siempre pueda responder.
    expect(data.checks.fallback_rules).toBe(true);
  });
});

describe('GET /api/v1/metadata', () => {
  it('responde 200 con la información del servicio', async () => {
    const response = await metadataGET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.service).toBe('novatareas-ai');
    expect(data.version).toBeDefined();
    expect(data.primary_model).toBeDefined();
  });

  it('documenta el contrato de entrada y salida', async () => {
    const response = await metadataGET();
    const data = await response.json();

    expect(data.input_contract.titulo).toMatch(/obligatorio/i);
    expect(data.output_contract.recomendacion).toBeDefined();
    expect(data.endpoints.recommend.method).toBe('POST');
  });
});

// IMPORTANTE: aiEngine.js lee ZAI_API_KEY en una constante al cargar el módulo,
// por lo que no puede sobrescribirse desde aquí. Para que estas pruebas no
// consuman saldo ni dependan de la red, el workflow de CI NO debe exponer la
// variable ZAI_API_KEY en el paso de tests: sin ella, el motor cae al fallback
// de reglas locales y responde igual de rápido y de forma determinista.
describe('POST /api/v1/recommend — payload válido', () => {
  it('responde 200 y devuelve una recomendación', async () => {
    const response = await recommendPOST(
      makeContext({ titulo: 'Estudiar para el examen de cálculo', prioridad: 'alta', tipo_usuario: 'estudiante' })
    );

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.recomendacion).toBeDefined();
    expect(typeof data.recomendacion).toBe('string');
    expect(data.recomendacion.length).toBeGreaterThan(0);
  });

  it('devuelve la fuente que generó la recomendación', async () => {
    const response = await recommendPOST(makeContext({ titulo: 'Preparar reunión de equipo' }));
    const data = await response.json();

    expect(['zai', 'ollama', 'rules']).toContain(data.fuente);
  });

  it('hace eco de los datos normalizados de la tarea', async () => {
    const response = await recommendPOST(
      makeContext({ titulo: 'Comprar pan', prioridad: 'BAJA' })
    );
    const data = await response.json();

    expect(data.tarea.titulo).toBe('Comprar pan');
    expect(data.tarea.prioridad).toBe('baja');
  });
});

describe('POST /api/v1/recommend — errores controlados', () => {
  it('rechaza peticiones sin la API key externa', async () => {
    const response = await recommendPOST(
      makeContext({ titulo: 'Intento sin autorización' }, '10.0.0.9', null)
    );
    expect(response.status).toBe(401);
  });

  it('rechaza una API key externa incorrecta', async () => {
    const response = await recommendPOST(
      makeContext({ titulo: 'Intento con clave incorrecta' }, '10.0.0.10', 'incorrecta')
    );
    expect(response.status).toBe(401);
  });

  it('responde 400 cuando falta el título', async () => {
    const response = await recommendPOST(makeContext({ prioridad: 'alta' }, '10.0.0.1'));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/titulo/i);
  });

  it('responde 400 cuando la prioridad es inválida', async () => {
    const response = await recommendPOST(
      makeContext({ titulo: 'Tarea', prioridad: 'altisima' }, '10.0.0.2')
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/prioridad/i);
  });

  it('responde 400 cuando el cuerpo no es JSON válido', async () => {
    const response = await recommendPOST(makeContext('{ esto no es json', '10.0.0.3'));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/json/i);
  });

  it('responde 405 si se usa GET en lugar de POST', async () => {
    const response = await recommendGET();

    expect(response.status).toBe(405);
    const data = await response.json();
    expect(data.error).toMatch(/no permitido/i);
  });
});
