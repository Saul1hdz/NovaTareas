import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k?.trim() && !process.env[k.trim()])
      process.env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  });
}

const GEMINI_KEY   = process.env.GEMINI_API_KEY?.trim();
const OLLAMA_URL   = process.env.OLLAMA_URL || 'http://localhost:11434';
const TEST_TEXT    = 'Estudiar para el examen de matemáticas';

console.log('=== DIAGNÓSTICO DE EMBEDDINGS ===\n');
console.log(`GEMINI_API_KEY : ${GEMINI_KEY ? '✅ CONFIGURADA' : '❌ NO DEFINIDA'}`);
console.log(`OLLAMA_URL     : ${OLLAMA_URL}`);
console.log('');

// ── Test 1: Gemini embedding-004 ─────────────────────────────────────────────
if (GEMINI_KEY) {
  console.log('📡 Probando Gemini embedding-004...');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-004:embedContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:   'models/gemini-embedding-004',
          content: { parts: [{ text: TEST_TEXT }] },
          taskType: 'RETRIEVAL_DOCUMENT',
        }),
      }
    );
    const body = await res.text();
    if (res.ok) {
      const data = JSON.parse(body);
      const vec  = data?.embedding?.values;
      console.log(`  ✅ Gemini OK — vector de ${vec?.length} dimensiones`);
    } else {
      console.log(`  ❌ Gemini falló — HTTP ${res.status}`);
    }
  } catch {
    console.log('  ❌ Gemini error de red');
  }
} else {
  console.log('⏭  Gemini: clave no definida, saltando.');
}

// ── Test 2: Ollama /api/tags (¿está corriendo?) ───────────────────────────────
console.log('\n📡 Probando Ollama (¿está corriendo?)...');
try {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (res.ok) {
    const data = await res.json();
    const models = data?.models?.map(m => m.name) || [];
    console.log(`  ✅ Ollama corriendo — modelos disponibles:`);
    if (models.length) models.forEach(m => console.log(`     • ${m}`));
    else console.log('     (sin modelos descargados)');

    // ── Test 3: nomic-embed-text ──────────────────────────────────────────────
    const hasNomic = models.some(m => m.includes('nomic-embed-text'));
    console.log(`\n📡 Probando nomic-embed-text...`);
    if (!hasNomic) {
      console.log('  ⚠️  nomic-embed-text NO está descargado.');
      console.log('  👉 Ejecuta: ollama pull nomic-embed-text');
    } else {
      try {
        const embRes = await fetch(`${OLLAMA_URL}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: TEST_TEXT }),
          signal: AbortSignal.timeout(15000),
        });
        if (embRes.ok) {
          const data = await embRes.json();
          console.log(`  ✅ nomic-embed-text OK — vector de ${data?.embedding?.length} dimensiones`);
        } else {
          console.log(`  ❌ nomic-embed-text falló — HTTP ${embRes.status}`);
        }
      } catch {
        console.log('  ❌ nomic-embed-text error de red');
      }
    }

    // ── Test 4: llama3.2:3b (para comparar) ──────────────────────────────────
    const hasLlama = models.some(m => m.includes('llama3.2'));
    console.log(`\n📡 Verificando llama3.2:3b (modelo de texto)...`);
    console.log(hasLlama ? '  ✅ llama3.2 disponible' : '  ⚠️  llama3.2 no encontrado');

  } else {
    console.log(`  ❌ Ollama respondió HTTP ${res.status}`);
  }
} catch {
  console.log('  ❌ Ollama no disponible');
}

console.log('\n=== FIN DEL DIAGNÓSTICO ===');
console.log('\n💡 Solución rápida si todo falló:');
console.log('   ollama pull nomic-embed-text   ← para embeddings locales');
console.log('   O agrega GEMINI_API_KEY en tu .env con una clave válida');
