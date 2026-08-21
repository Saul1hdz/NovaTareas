// Debe ir antes del import siguiente: Vitest evalúa este archivo antes de
// cargar `.env`, así que sin esto un TEST_DATABASE_URL definido en `.env` se
// ignoraría y las pruebas irían siempre al puerto por defecto.
import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/databaseUrl.js';

export default defineConfig({
  test: {
    // Entorno Node: los endpoints son handlers de servidor, no componentes de UI.
    environment: 'node',

    // Solo se ejecutan los archivos dentro de tests/
    include: ['tests/**/*.test.js'],

    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setupFile.js'],
    fileParallelism: false,

    // ─────────────────────────────────────────────────────────────────────────
    // AISLAMIENTO DEL ENTORNO DE PRUEBAS
    //
    // Vitest carga automáticamente el archivo .env del proyecto. Sin este
    // bloque, las pruebas usarían las credenciales reales y llamarían a la API
    // de IA por internet: serían lentas, consumirían saldo en cada ejecución y
    // fallarían por timeout o por falta de cuota.
    //
    // Al vaciar las claves de los proveedores remotos y apuntar OLLAMA_URL a un
    // puerto cerrado, el motor cae de inmediato a su fallback de reglas locales,
    // que es determinista y responde sin red. Esto se define aquí (no dentro de
    // los tests) porque aiEngine.js lee estas variables al cargar el módulo,
    // antes de que cualquier instrucción del test pueda modificarlas.
    //
    // Cada proveedor nuevo del router hay que añadirlo AQUÍ además de al código:
    // OPENROUTER_API_KEY se olvidó al principio y, en cuanto hubo una clave real
    // en el `.env` del portátil, quince pruebas se pusieron a llamar a OpenRouter
    // por internet.
    // ─────────────────────────────────────────────────────────────────────────
    env: {
      ZAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      AI_API_KEY: 'api-externa-solo-para-pruebas',
      TOKEN_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
      OLLAMA_URL: 'http://127.0.0.1:1',
      SECRET_KEY: 'clave-solo-para-pruebas',
      CRON_SECRET: 'cron-solo-para-pruebas',
      TELEGRAM_WEBHOOK_SECRET: 'telegram-solo-para-pruebas',
      TELEGRAM_BOT_TOKEN: '',
      REGISTRATION_ENABLED: 'true',
      APP_TIME_ZONE: 'America/El_Salvador',
      GOOGLE_CLIENT_ID: 'google-client-solo-para-pruebas',
      GOOGLE_CLIENT_SECRET: 'google-secret-solo-para-pruebas',
      GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4321/api/google/callback',

      // Las pruebas corren contra el mismo motor que producción: PostgreSQL 16.
      DATABASE_URL: TEST_DATABASE_URL,

      // Fija la zona del proceso para que las comparaciones de fecha no dependan
      // de la máquina: PostgreSQL interpreta los timestamps sin zona según la
      // configuración del servidor, y sin esto los recordatorios se desplazan.
      TZ: 'UTC',
    },

    // Con el fallback local la respuesta es casi inmediata; 10 s es margen de sobra.
    testTimeout: 10000,

    // Salida legible en la consola y en GitHub Actions
    reporters: ['verbose'],
  },
});
