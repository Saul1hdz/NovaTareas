// src/pages/api/v1/metadata.js
export const prerender = false;

import { AI_META } from '../../../lib/aiEngine.js';

export async function GET() {
  const body = {
    ...AI_META,
    endpoints: {
      health:    { method: 'GET',  path: '/api/v1/health',    description: 'Estado del servicio.' },
      metadata:  { method: 'GET',  path: '/api/v1/metadata',  description: 'Información del servicio y contrato.' },
      recommend: { method: 'POST', path: '/api/v1/recommend', description: 'Genera una recomendación de productividad para una tarea.' },
    },
    input_contract: {
      titulo:       'string, obligatorio, máx 200 caracteres',
      descripcion:  'string, opcional, máx 1000 caracteres',
      prioridad:    'string, opcional, uno de: baja | media | alta | urgente (por defecto media)',
      tipo_usuario: 'string, opcional, uno de: comun | estudiante | empleado (por defecto comun)',
      fecha_limite: 'string, opcional, formato YYYY-MM-DD',
    },
    output_contract: {
      recomendacion: 'string — texto de la recomendación generada',
      fuente:        'string — zai | ollama | rules (qué motor la produjo)',
      tarea:         'object — eco de los datos normalizados de entrada',
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
