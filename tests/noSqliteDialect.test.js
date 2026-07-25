import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// PostgreSQL es el único motor. Este test es la barrera que impide que el
// dialecto de SQLite vuelva a entrar sin que nadie lo note: la capa de
// traducción ya no existe, así que un `?` en una consulta fallaría en runtime
// y no en las pruebas si el camino no está cubierto.

const ROOTS = ['src', 'scripts', 'telegram'];
const EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.astro']);

const FORBIDDEN = [
  { pattern: /\bGROUP_CONCAT\s*\(/i, reason: 'GROUP_CONCAT es de SQLite; usa STRING_AGG' },
  { pattern: /\bunixepoch\s*\(/i, reason: 'unixepoch() es de SQLite; usa CURRENT_TIMESTAMP' },
  { pattern: /datetime\s*\(\s*'now'/i, reason: "datetime('now') es de SQLite; usa NOW()" },
  { pattern: /\blastInsertRowid\b/, reason: 'lastInsertRowid es de SQLite; usa RETURNING id' },
  { pattern: /\bbetter-sqlite3\b/, reason: 'better-sqlite3 se retiró del proyecto' },
  { pattern: /\bDATABASE_ENGINE\b/, reason: 'DATABASE_ENGINE ya no selecciona motor' },
  { pattern: /\bisPostgres\b/, reason: 'isPostgres ya no existe: PostgreSQL es el único motor' },
];

// Solo interesan los `?` que viven dentro de un literal con SQL. Buscarlos en
// el código suelto da falsos positivos: `update.callback_query?.` combina una
// palabra parecida a UPDATE con el encadenamiento opcional.
const STRING_LITERAL = /(['`])((?:[^'`\\]|\\.)*?)\1/gs;
const SQL_STATEMENT = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/;

function hasSqlWithQuestionMark(content) {
  for (const [, , body] of content.matchAll(STRING_LITERAL)) {
    if (SQL_STATEMENT.test(body) && body.includes('?')) return true;
  }
  return false;
}

function collectFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, found);
    else if (EXTENSIONS.has(path.extname(entry))) found.push(full);
  }
  return found;
}

describe('el código no contiene dialecto SQLite', () => {
  const files = ROOTS.flatMap(root => collectFiles(root));

  it('encuentra archivos que revisar', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no usa construcciones propias de SQLite', () => {
    const offenders = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const { pattern, reason } of FORBIDDEN) {
        if (pattern.test(content)) offenders.push(`${file}: ${reason}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('usa placeholders numerados en lugar de signos de interrogación', () => {
    const offenders = files
      .filter(file => hasSqlWithQuestionMark(readFileSync(file, 'utf8')))
      .map(file => `${file}: usa $1..$n en lugar de ?`);

    expect(offenders).toEqual([]);
  });
});
