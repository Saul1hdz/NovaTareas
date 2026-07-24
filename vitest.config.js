import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Entorno Node: los endpoints son handlers de servidor, no componentes de UI.
    environment: 'node',

    // Solo se ejecutan los archivos dentro de tests/
    include: ['tests/**/*.test.js'],
    globalSetup: ['./tests/globalSetup.js'],
    fileParallelism: false,

    // ─────────────────────────────────────────────────────────────────────────
    // AISLAMIENTO DEL ENTORNO DE PRUEBAS
    //
    // Vitest carga automáticamente el archivo .env del proyecto. Sin este
    // bloque, las pruebas usarían las credenciales reales y llamarían a la API
    // de IA por internet: serían lentas, consumirían saldo en cada ejecución y
    // fallarían por timeout o por falta de cuota.
    //
    // Al vaciar ZAI_API_KEY y apuntar OLLAMA_URL a un puerto cerrado, el motor
    // cae de inmediato a su fallback de reglas locales, que es determinista y
    // responde sin red. Esto se define aquí (no dentro de los tests) porque
    // aiEngine.js lee estas variables al cargar el módulo, antes de que
    // cualquier instrucción del test pueda modificarlas.
    // ─────────────────────────────────────────────────────────────────────────
    env: {
      ZAI_API_KEY: '',
      AI_API_KEY: 'api-externa-solo-para-pruebas',
      OLLAMA_URL: 'http://127.0.0.1:1',
      SECRET_KEY: 'clave-solo-para-pruebas',
      CRON_SECRET: 'cron-solo-para-pruebas',
      TELEGRAM_WEBHOOK_SECRET: 'telegram-solo-para-pruebas',
      NOVATAREAS_DB_PATH: 'tmp/vitest-novatareas.sqlite',
    },

    // Con el fallback local la respuesta es casi inmediata; 10 s es margen de sobra.
    testTimeout: 10000,

    // Salida legible en la consola y en GitHub Actions
    reporters: ['verbose'],
  },
});
