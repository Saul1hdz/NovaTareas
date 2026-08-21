import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recommendationSourceEnum } from '../src/db/postgres/schema.js';

// Cada origen que la base puede guardar tiene que tener su etiqueta en el
// dashboard. Sin esto, un proveedor nuevo pasa el backend, la migración y los
// tests, y en la interfaz aparece como «Sugerencia» —indistinguible del
// fallback de reglas locales, que es precisamente lo que NO respondió—. Pasó
// con `openrouter`: Ox Alpha contestaba y la tarjeta decía «Sugerencia».

const dashboard = readFileSync(new URL('../src/pages/dashboard.astro', import.meta.url), 'utf8');

function etiquetasDeclaradas() {
  const bloque = dashboard.match(/const RECOMMENDATION_SOURCES = \{([\s\S]*?)\};/);
  if (!bloque) throw new Error('No se encontró RECOMMENDATION_SOURCES en dashboard.astro');
  return [...bloque[1].matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]);
}

describe('etiquetas de origen de la recomendación', () => {
  it('el dashboard etiqueta todos los orígenes que la base acepta', () => {
    const declaradas = etiquetasDeclaradas();
    const sinEtiqueta = recommendationSourceEnum.enumValues.filter(v => !declaradas.includes(v));

    expect(sinEtiqueta, `orígenes sin etiqueta en el dashboard: ${sinEtiqueta.join(', ')}`)
      .toEqual([]);
  });

  it('no etiqueta orígenes que la base no puede guardar', () => {
    const sobrantes = etiquetasDeclaradas()
      .filter(v => !recommendationSourceEnum.enumValues.includes(v));

    expect(sobrantes, `etiquetas de orígenes inexistentes: ${sobrantes.join(', ')}`).toEqual([]);
  });
});
