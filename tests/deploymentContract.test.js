import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../compose.prod.yml', import.meta.url), 'utf8');

describe('contrato del runtime de producción', () => {
  it('incluye el código del bot en la imagen runtime', () => {
    expect(dockerfile).toMatch(/COPY --from=build \/app\/telegram \.\/telegram/);
  });

  it('no aplica el healthcheck HTTP de la web al bot de polling', () => {
    const botSection = compose.match(/\n  bot:\n([\s\S]*?)(?=\nvolumes:)/)?.[1] || '';
    expect(botSection).toMatch(/healthcheck:\s*\n\s+disable: true/);
  });
});
