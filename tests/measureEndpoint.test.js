import { describe, expect, it } from 'vitest';
import { percentile, summarize } from '../scripts/measure-endpoint.mjs';

describe('estadística de la línea base', () => {
  it('calcula percentiles por interpolación sobre la muestra ordenada', () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(sorted, 0.5)).toBeCloseTo(50.5, 5);
    expect(percentile(sorted, 0.95)).toBeCloseTo(95.05, 5);
  });

  it('no confunde el p95 con el máximo en muestras pequeñas', () => {
    // 20 muestras donde la última es un valor atípico: si el p95 se calculara
    // por índice redondeado hacia arriba, devolvería 900 y el informe diría que
    // el 5% de las peticiones tarda casi un segundo, lo cual es falso.
    const sorted = [...Array.from({ length: 19 }, () => 40), 900];
    const p95 = percentile(sorted, 0.95);
    expect(p95).toBeLessThan(900);
    expect(p95).toBeGreaterThan(40);
  });

  it('gestiona muestras triviales sin romperse', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
  });

  it('resume solicitudes, errores y códigos observados', () => {
    const samples = [
      { duration_ms: 10, status: 200, ok: true },
      { duration_ms: 20, status: 200, ok: true },
      { duration_ms: 30, status: 200, ok: true },
      { duration_ms: 40, status: 500, ok: false },
    ];
    const summary = summarize(samples);

    expect(summary.requests).toBe(4);
    expect(summary.errors).toBe(1);
    expect(summary.error_rate).toBe(25);
    expect(summary.min_ms).toBe(10);
    expect(summary.max_ms).toBe(40);
    expect(summary.avg_ms).toBe(25);
    expect(summary.status_codes).toEqual({ 200: 3, 500: 1 });
  });

  it('cuenta como error cualquier estado distinto del esperado', () => {
    // Un 429 del límite de uso no es "una respuesta más": si aparece durante la
    // medición, la línea base está midiendo el rechazo, no el trabajo real.
    const summary = summarize([
      { duration_ms: 12, status: 200, ok: true },
      { duration_ms: 3, status: 429, ok: false },
    ]);
    expect(summary.error_rate).toBe(50);
    expect(summary.status_codes['429']).toBe(1);
  });
});
