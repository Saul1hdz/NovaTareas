import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardSource = readFileSync(
  new URL('../src/pages/dashboard.astro', import.meta.url),
  'utf8',
);

const genAiBlock = dashboardSource.match(
  /async function genAI\(taskId\) \{[\s\S]*?\n\}\n\n\/\/ ── CREATE TASK ──/,
)?.[0];

describe('solicitud IA desde el dashboard', () => {
  it('envía JSON para superar la protección CSRF de Astro', () => {
    expect(genAiBlock).toBeTruthy();
    expect(genAiBlock).toContain("headers: { 'Content-Type': 'application/json' }");
    expect(genAiBlock).toContain("body: '{}'");
  });

  it('tolera errores HTTP no JSON y siempre restaura el botón', () => {
    expect(genAiBlock).toContain("res.headers.get('content-type')");
    expect(genAiBlock).toContain('if (!res.ok)');
    expect(genAiBlock).toContain('catch (error)');
    expect(genAiBlock).toContain('finally');
    expect(genAiBlock).toContain("btn.disabled = false; btn.textContent = ' Consejos';");
  });

  it('cancela una espera de frontend que excede el límite del proveedor', () => {
    expect(genAiBlock).toContain('new AbortController()');
    expect(genAiBlock).toContain('controller.abort()');
    expect(genAiBlock).toContain('signal: controller.signal');
  });
});
