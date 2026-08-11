import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profileSource = readFileSync(
  new URL('../src/pages/profile.astro', import.meta.url),
  'utf8',
);

describe('solicitud de vinculación Telegram desde el perfil', () => {
  it('envía JSON para que la protección CSRF de Astro permita el POST', () => {
    const requestBlock = profileSource.match(
      /fetch\('\/api\/telegram\/link-code',[\s\S]*?\n\s*\}\);/,
    )?.[0];

    expect(requestBlock).toBeTruthy();
    expect(requestBlock).toContain("headers: { 'Content-Type': 'application/json' }");
    expect(requestBlock).toContain("body: '{}'");
    expect(profileSource).toContain("response.headers.get('content-type')");
    expect(profileSource).toContain("`Error del servidor (HTTP ${response.status}).`");
  });
});
