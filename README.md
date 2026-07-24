# ✦ NovaTareas Pro

**Asistente Personal Inteligente de Gestión de Tareas con IA**

Universidad Gerardo Barrios — Módulo 4: Desarrollo de Aplicaciones con IA
Docente: Ing. Marco Arévalo Zambrano

---

## Integrantes — Equipo 3

| Nombre | Carné |
|---|---|
| Saúl Oswaldo López Hernández | SMIS108421 |
| Moises Antonio Martínez | SMIS071221 |
| Enson Onan Carranza Rodríguez | SMIS013020 |

---

## Índice

1. [Problema que se desea resolver](#1-problema-que-se-desea-resolver)
2. [Usuarios o beneficiarios](#2-usuarios-o-beneficiarios)
3. [Descripción general de la solución](#3-descripción-general-de-la-solución)
4. [Dónde está la inteligencia artificial](#4-dónde-está-la-inteligencia-artificial)
5. [Modelo, servicio y técnica utilizada](#5-modelo-servicio-y-técnica-utilizada)
6. [Datos de entrada y salida](#6-datos-de-entrada-y-salida)
7. [API inteligente](#7-api-inteligente)
8. [Pruebas automatizadas](#8-pruebas-automatizadas)
9. [Integración continua (CI/CD)](#9-integración-continua-cicd)
10. [Instalación y ejecución](#10-instalación-y-ejecución)
11. [Variables de entorno](#11-variables-de-entorno)
12. [Estructura del repositorio](#12-estructura-del-repositorio)
13. [Arquitectura](#13-arquitectura)
14. [Limitaciones conocidas](#14-limitaciones-conocidas)
15. [Plan de mejora por semana](#15-plan-de-mejora-por-semana)
16. [Documentación adicional](#16-documentación-adicional)
17. [Stack tecnológico](#17-stack-tecnológico)

---

## 1. Problema que se desea resolver

Los estudiantes universitarios en El Salvador gestionan simultáneamente múltiples asignaturas, proyectos y responsabilidades personales. Una encuesta aplicada en febrero de 2026 a estudiantes de la UGB reveló que:

- **80%** califica la organización de tareas como difícil o muy difícil.
- **80%** olvida entregas al menos 1–3 veces por ciclo académico.
- **80–90%** reporta que la desorganización afecta negativamente sus calificaciones.

Las herramientas existentes (Todoist, Notion, Trello) son de pago, están en inglés y no incorporan IA contextual que aprenda del historial personal del usuario.

---

## 2. Usuarios o beneficiarios

- **Estudiantes universitarios** con alta carga académica.
- **Empleados** que gestionan múltiples proyectos simultáneos.
- Cualquier persona que necesite organización personal con asistencia de IA, sin pagar por herramientas externas.

---

## 3. Descripción general de la solución

NovaTareas Pro es una aplicación web full-stack con bot de Telegram integrado. El usuario accede por tres canales que comparten la misma base de datos y lógica:

- **Dashboard web** (Astro SSR): gestión visual de tareas con prioridades, etiquetas, calendario, historial de cambios y comentarios de progreso.
- **Bot de Telegram**: creación de tareas conversacional, recomendaciones de IA y notificaciones proactivas (tarea creada, completada, urgente, próxima a vencer, vencida).
- **API externa protegida**: la capacidad inteligente expuesta como servicio REST para clientes autorizados mediante una API key propia.

El sistema registra automáticamente cada cambio realizado sobre una tarea (historial) y permite al usuario agregar notas de progreso. Toda esa información acumulada se usa como contexto para mejorar las respuestas de la IA con el tiempo.

---

## 4. Dónde está la inteligencia artificial

La IA vive en estos archivos concretos:

```
src/lib/aiEngine.js                 ← motor de recomendaciones reutilizable
src/lib/rag.js                      ← genera embeddings y recupera tareas similares
src/pages/api/tasks/[id]/ai.js      ← endpoint de recomendaciones (dashboard)
src/pages/api/v1/recommend.js       ← endpoint de IA consumible por API externa
src/lib/telegramBot.js              ← función getAiRecommendation (bot)
```

**Flujo completo de una recomendación:**

```
Usuario solicita consejo
        ↓
rag.js convierte la tarea en vector numérico (embedding)
        ↓
Busca las 5 tareas más similares del historial del usuario
(similitud coseno, umbral mínimo 0.25)
        ↓
Construye el prompt con: tarea + tareas similares + historial de cambios
+ comentarios previos + tipo de usuario
        ↓
Envía a z.ai (GLM) → si falla → Ollama local → si falla → historial archivado
→ si falla → reglas locales
        ↓
Devuelve recomendación en español al dashboard, a Telegram o a la API
```

La **cascada de fallback** es una decisión de diseño central: garantiza que el usuario siempre reciba una respuesta útil, incluso sin conexión a internet, sin saldo en la API o sin Ollama instalado.

---

## 5. Modelo, servicio y técnica utilizada

| Componente | Detalle |
|---|---|
| **Modelo principal** | z.ai — GLM (`glm-4.5-flash`) |
| **Modelo de embeddings** | z.ai (`embedding-2` / `embedding-3`) con fallback Ollama `nomic-embed-text` |
| **Modelo local (fallback)** | Ollama + Llama 3.2:3b |
| **Técnica RAG** | Retrieval-Augmented Generation con similitud coseno |
| **Tipo de IA** | IA generativa (LLM) + búsqueda semántica |
| **NLP** | Implícito vía el modelo GLM (transformers internos) |
| **Sistema de fallback** | Cascada: z.ai → Ollama → historial → reglas locales |
| **Evaluación** | Validación manual por el equipo; métrica formal de utilidad pendiente |

> **Nota sobre la migración:** el proyecto usaba originalmente Google Gemini. Se migró a z.ai (GLM) por disponibilidad y costo. El código llama a la API mediante `fetch` directo al endpoint `https://api.z.ai/api/paas/v4/chat/completions` y ya no depende de ningún SDK de Google. El modelo se configura con la variable de entorno `ZAI_MODEL`.

---

## 6. Datos de entrada y salida

### Entrada al modelo de IA

```
- Título de la tarea (texto libre)
- Descripción de la tarea (texto libre, opcional)
- Prioridad actual: urgente | alta | media | baja
- Fecha límite (YYYY-MM-DD, opcional)
- Tipo de usuario: estudiante | empleado | comun
- Historial de cambios de la tarea (campo, valor anterior, valor nuevo, fecha)
- Comentarios de progreso previos (máximo 10)
- TOP 5 tareas similares del historial del usuario (recuperadas por RAG)
```

### Salida del modelo

```
- Texto en español con recomendaciones prácticas
- Oraciones cortas separadas por punto (máximo ~130 palabras)
- Formato: texto plano con Markdown (convertido a HTML para Telegram)
- Sin introducciones genéricas — responde directamente al contexto de la tarea
```

### Ejemplo real

```
Entrada:  "preparar presentacion del proyecto de ventas" (Alta, 20 jun, tipo: empleado)

Salida:   "Divide la presentación en 3 bloques lógicos antes de redactar.
           Revisa presentaciones anteriores de tu historial para tomar estructura.
           Reserva 45 minutos hoy para el esqueleto inicial sin distracciones."
```

---

## 7. API inteligente

La capacidad de IA se expone como servicio REST consumible desde cualquier cliente externo (curl, Postman, Swagger). Es **independiente del dashboard**: no requiere sesión ni que la tarea exista previamente en la base de datos.

| Método | Ruta | Propósito |
|---|---|---|
| GET  | `/api/v1/health`    | Verificar que el servicio está activo. |
| GET  | `/api/v1/metadata`  | Versión, modelo, propósito y contrato. |
| POST | `/api/v1/recommend` | Generar una recomendación de productividad. |

### Contrato de entrada (`POST /api/v1/recommend`)

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `titulo` | string | **Sí** | No vacío, máx. 200 caracteres |
| `descripcion` | string | No | Máx. 1000 caracteres |
| `prioridad` | string | No | `baja` \| `media` \| `alta` \| `urgente` (default `media`) |
| `tipo_usuario` | string | No | `comun` \| `estudiante` \| `empleado` (default `comun`) |
| `fecha_limite` | string | No | Formato `YYYY-MM-DD` |

### Ejemplo de uso

```bash
curl -X POST http://localhost:4321/api/v1/recommend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_API_KEY" \
  -d '{"titulo":"Estudiar para el examen de cálculo","prioridad":"alta","tipo_usuario":"estudiante"}'
```

**Respuesta exitosa (200):**

```json
{
  "recomendacion": "Empieza por dividir el temario en 3 bloques...",
  "fuente": "zai",
  "tarea": { "titulo": "...", "prioridad": "alta", "tipo_usuario": "estudiante" }
}
```

**Respuesta con error (400):**

```json
{ "error": "El campo \"titulo\" es obligatorio y no puede estar vacío." }
```

El campo `fuente` indica qué motor generó la respuesta: `zai`, `ollama` o `rules`.

Contrato completo, validaciones, códigos de error y evidencia de prueba en **[`/api.md`](/api.md)**.

---

## 8. Pruebas automatizadas

El proyecto usa **Vitest**, elegido sobre Jest por su compatibilidad nativa con módulos ESM y con el ecosistema de Astro.

### Comandos

```bash
npm test              # ejecutar todas las pruebas una vez
npm run test:watch    # modo observador (se relanzan al guardar cambios)
npm run test:coverage # con reporte de cobertura
npm run lint          # verificar tipos y sintaxis del proyecto
```

### Qué se prueba

| Archivo | Pruebas | Cobertura |
|---|---|---|
| `tests/aiEngine.test.js` | 14 | Validación de entrada: títulos vacíos o muy largos, descripciones fuera de límite, prioridades no permitidas, fechas mal formadas, cuerpos que no son objetos |
| `tests/api.test.js` | 13 | Endpoints `/api/v1/health`, `/api/v1/metadata` y `/api/v1/recommend`, incluida la autenticación de la API externa |
| `tests/appFlows.test.js` | 14 | Registro, login, logout, cambio de contraseña, ciclo de vida de tareas, ownership, subtareas, historial, comentarios y vinculación de Telegram |
| `tests/security.test.js` | 6 | Sesiones, cookies, rate limiting, secretos, logs seguros y Google OAuth `state` |
| `tests/migrations.test.js` | 2 | Creación idempotente del esquema y rechazo seguro de bases heredadas |
| `tests/taskValidation.test.js` | 3 | Validación de tareas, fechas, estados, etiquetas y comentarios |
| `tests/integrationSecurity.test.js` | 8 | Cron, webhook de Telegram simulado y carga de avatares válidos, falsificados o con MIME incorrecto |
| `tests/postgresSchema.test.js` | 7 | Esquema, restricciones y reejecución de migraciones PostgreSQL con PGlite |
| `tests/tokenEncryption.test.js` | 3 | Cifrado, descifrado y rechazo de tokens alterados |
| `tests/reminders.test.js` | 4 | Zona horaria, tiempo verbal de fechas, avisos únicos y ausencia de marcación cuando Telegram falla |
| `tests/aiProviders.test.js` | 3 | z.ai, Ollama y fallback local con red simulada |
| `tests/aiPrompt.test.js` | 3 | El prompt no inventa antecedentes y trata RAG como evidencia opcional |
| `tests/googleIntegration.test.js` | 4 | OAuth, eventos, renovación y persistencia cifrada de tokens con Google simulado |

**Total: 84 pruebas.** Las pruebas de base de datos usan un archivo SQLite
temporal y aislado de la base de desarrollo; el esquema PostgreSQL se prueba con
PGlite y el workflow usa además un servicio PostgreSQL 16 efímero.

### Cómo funcionan

Las pruebas de endpoints siguen el mismo principio que el `TestClient` de FastAPI: en lugar de levantar el servidor y lanzar peticiones manuales, **importan el handler del endpoint y le pasan un objeto `Request`**. No necesitan puerto abierto ni intervención humana.

### Decisión técnica: pruebas sin dependencias externas

Las pruebas **no llaman a servicios externos reales**. z.ai, Ollama, Telegram y
Google se simulan de forma controlada; los casos offline fuerzan las reglas
locales. Las credenciales del entorno de pruebas son ficticias.

Esto aporta tres beneficios:

1. Las pruebas son **deterministas**: siempre el mismo resultado.
2. **No consumen saldo** de la API en cada ejecución.
3. **No fallan** por problemas de red o cuota agotada.

El mapa completo de pruebas —qué comportamientos se validan y por qué aportan valor— está en **[`docs/pruebas-semana-3.md`](docs/pruebas-semana-3.md)**.

Los errores detectados durante la implementación, las correcciones aplicadas y los bloqueos técnicos que siguen abiertos están documentados en **[`docs/registro-pruebas-semana-3.md`](docs/registro-pruebas-semana-3.md)**.

---

## 9. Integración continua (CI/CD)

El archivo `.github/workflows/ci.yml` ejecuta automáticamente en GitHub Actions con cada `push` o `pull request`:

1. **Descarga** del repositorio (`actions/checkout`).
2. **Configuración** de Node.js 22.12 con caché de npm.
3. **Instalación** de dependencias con `npm ci` (reproducible desde `package-lock.json`).
4. **Verificación** de tipos y sintaxis (`npm run lint`).
5. **Migración y comprobación** contra un servicio PostgreSQL 16 efímero.
6. **Ejecución** de las 84 pruebas con cobertura (`npm run test:coverage`).
7. **Conservación** del reporte de cobertura como artefacto durante 14 días.
8. **Compilación** del proyecto (`npm run build`).

El workflow **no expone `ZAI_API_KEY` ni credenciales reales**. Las pruebas usan
secretos ficticios, no consumen saldo y cualquier fallo crítico detiene el job.
La configuración quedó confirmada en GitHub Actions sobre la rama `testing`:
[ejecución 30121273529](https://github.com/Saul1hdz/NovaTareas/actions/runs/30121273529).

---

## 10. Instalación y ejecución

### Requisitos previos

- Node.js `>=22.12.0 <23.0.0` (la versión indicada en `.nvmrc`)
- PostgreSQL 16 o Docker/WSL son opcionales hasta el Bloque 4
- API key de [z.ai](https://z.ai) para el modelo `glm-4.5-flash`
- Bot de Telegram creado con [@BotFather](https://t.me/BotFather)
- (Opcional) [Ollama](https://ollama.com) con `nomic-embed-text` y `llama3.2:3b` para fallback local

### Pasos

```bash
# 1. Usar Node 22 e instalar exactamente el lockfile
nvm use 22
npm ci

# 2. Configurar entorno
cp .env.example .env
# Editar .env con tus claves reales (ver sección de variables de entorno)

# 3. Crear o actualizar de forma segura la base SQLite local
npm run db:init
# El migrador puede repetirse y rechaza bases heredadas no inventariadas

# 4. Verificar que todo funciona
npm test
npm run db:pg:verify

# 5. Iniciar el servidor web
npm run dev
# → http://localhost:4321

# 6. Iniciar el bot de Telegram (terminal separada)
npm run bot:dev

# 7. Iniciar el scheduler de recordatorios (terminal separada)
npm run bot:scheduler
```

### Registrar el webhook de Telegram

Se necesita una URL pública HTTPS. En desarrollo local se usa ngrok:

```bash
npx ngrok http 4321
# Copia la URL que te da, ej: https://abc123.ngrok.io
```

Luego se registra el webhook una sola vez:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://abc123.ngrok.io/api/telegram/webhook
```

### Qué es automático y qué es manual

| Acción | ¿Automático? |
|---|---|
| Instalar dependencias (`npm ci`) | ✅ Automático con Node 22.12 o posterior |
| Crear tablas de BD (`npm run db:init`) | ✅ Migrador transaccional e idempotente |
| Ejecutar pruebas (`npm test`) | ✅ Automático |
| Validación en cada push (GitHub Actions) | ✅ Automático |
| Iniciar servidor web | ✅ Un comando |
| Iniciar bot de Telegram | ⚠️ Manual — terminal separada |
| Iniciar scheduler | ⚠️ Manual — terminal separada |
| Registrar webhook de Telegram | ⚠️ Manual — una vez por instalación |
| Configurar variables de entorno | ⚠️ Manual — copiar y completar `.env` |

---

## 11. Variables de entorno

Para probar ahora la aplicación, z.ai y el bot de Telegram mediante polling
local, basta con completar este grupo:

```env
SECRET_KEY=                 # Secreto aleatorio para firmar sesiones
ZAI_API_KEY=                # Credencial de z.ai
ZAI_MODEL=glm-4.5-flash
ZAI_EMB_ENABLED=false       # No probar embeddings de z.ai todavía
TELEGRAM_BOT_TOKEN=         # Token entregado por @BotFather
```

`npm run dev` inicia la web y `npm run bot:dev` inicia el bot en otra terminal.
El modo polling no necesita `TELEGRAM_WEBHOOK_SECRET`, una URL pública ni un
túnel HTTPS.

Las demás variables admitidas están documentadas como opcionales en
`.env.example`. Solo deben descomentarse al probar la función correspondiente:
webhook/cron, API externa de recomendaciones, Ollama, Google Calendar o
PostgreSQL. `GEMINI_API_KEY` solo aparece en herramientas manuales heredadas de
embeddings; no se necesita para ejecutar la web, z.ai ni el bot.

> ⚠️ Los archivos `.env` y `.env.local` **no se versionan** (están en `.gitignore`). El archivo `.env.example` sí, y contiene únicamente placeholders. No compartas el archivo real por chat ni reutilices los secretos locales en Netcup.

---

## 12. Estructura del repositorio

```
novatareas-pro/
├── .github/
│   └── workflows/
│       └── ci.yml                  # Pipeline de integración continua
├── src/
│   ├── pages/
│   │   ├── dashboard.astro
│   │   └── api/
│   │       ├── v1/{health,metadata,recommend}.js   # API externa protegida
│   │       ├── tasks.js
│   │       ├── tasks/[id].js
│   │       ├── tasks/[id]/{history,comments,ai}.js
│   │       ├── auth/recover.js
│   │       ├── google/{auth,callback,events}.js
│   │       ├── telegram/webhook.js
│   │       └── cron/reminders.js
│   └── lib/
│       ├── aiEngine.js      # motor de IA reutilizable (sin BD ni sesión)
│       ├── rag.js           # embeddings + recuperación semántica
│       ├── db.js            # acceso a SQLite
│       ├── auth.js          # JWT por cookie o Bearer token
│       ├── telegramBot.js
│       └── telegramNotify.js
├── tests/
│   ├── aiEngine.test.js           # 14 pruebas de validación
│   ├── api.test.js                # 13 pruebas de endpoints
│   └── integrationSecurity.test.js # cron, webhook y avatares
├── telegram/                # bot.js y scheduler.js (procesos aparte)
├── migrations/              # migraciones SQLite y PostgreSQL versionadas
├── src/db/postgres/         # esquema, cliente y repositorios Drizzle
├── compose.postgres.yml     # PostgreSQL 16 local, limitado a 127.0.0.1
├── tools/                   # utilidades de diagnóstico y reindexado
├── data/tareas_ejemplo.csv
├── docs/
│   ├── api.md                       # contratos de la API
│   ├── pruebas-semana-3.md          # mapa de pruebas
│   └── registro-pruebas-semana-3.md # errores, correcciones y bloqueos
├── .env.example
├── vitest.config.js
├── astro.config.mjs
└── package.json
```

---

## 13. Arquitectura

### Arquitectura actual (monolítica modular)

```
Usuario Web ──────→ Dashboard Astro (SSR)
                          ↓
Usuario Telegram ─→ Webhook /api/telegram/webhook
                          ↓
Cliente autorizado → API externa /api/v1/* (Bearer AI_API_KEY)
                          ↓
                  API Routes (src/pages/api/)
                  tasks.js · [id].js · comments.js · ai.js · v1/recommend.js
                          ↓
                  Capa de inteligencia
                  aiEngine.js · rag.js → z.ai (GLM) / Ollama → respuesta
                          ↓
                  SQLite (novatareas.db)
                  users · tasks · task_history · task_comments · task_embeddings
```

### Arquitectura objetivo (microservicios)

```
Cliente Web / App Móvil
        ↓
API Gateway
  ├── Servicio de tareas      (Node.js + PostgreSQL)
  ├── Servicio de IA y RAG    (z.ai + vector DB)
  ├── Servicio de notif.      (Node.js + queue)
  └── Servicio de auth        (JWT centralizado)
```

---

## 14. Limitaciones conocidas

1. **SQLite sigue siendo el runtime temporal** — PostgreSQL ya tiene esquema y
   migraciones reproducibles, pero la aplicación no cambia de motor hasta el
   Bloque 4.
2. **El bot y el scheduler requieren terminales manuales** — no hay un proceso único que los inicie todos.
3. **El estado de conversación del bot vive en memoria** — un reinicio del servidor cancela cualquier flujo de creación de tarea a medio completar.
4. **El webhook requiere URL pública** — en desarrollo local es necesario ngrok; si se cae, el bot deja de responder.
5. **Cuota de z.ai limitada** — el saldo de la cuenta puede agotarse; al fallar, el sistema cae al fallback local u offline.
6. **Cobertura de pruebas parcial** — las 84 pruebas ya cubren autenticación,
   recuperación, ownership, tareas, migraciones SQLite/PostgreSQL, cifrado de
   tokens, recordatorios, cron, webhook, avatares, códigos de vinculación de
   Telegram, proveedores de IA y rutas principales de Google simuladas; aún
   faltan pruebas amplias de la conversación del bot, RAG y el flujo visual de
   Google en el dashboard.
7. **RAG parcialmente conectado** — los embeddings existen en la base de datos, pero no todas las rutas del código los consumen todavía.
8. **Sin métrica formal de calidad** — no existe aún un sistema de feedback que mida la utilidad real de las recomendaciones.
9. **Sin logging estructurado** — las llamadas al modelo no registran modelo usado, tokens consumidos ni latencia.
10. **Rate limiting en memoria** — el contador se reinicia con el servidor y no funcionaría con varias instancias desplegadas.
11. **Migraciones heredadas aisladas** — `npm run db:init` usa únicamente migraciones nuevas, transaccionales y registradas. Si detecta una base heredada sin inventariar, se detiene sin modificarla; los scripts antiguos no forman parte del flujo normal.
12. **Código muerto pendiente de limpieza** — los módulos de una migración a Supabase abandonada (`src/lib/supabase.ts`, `src/lib/supabase-helpers.ts`, `src/lib/database.types.ts`, `supabase/schema.sql`) siguen en el repositorio sin ser importados por ningún archivo.
13. **Google Calendar en desarrollo** — los archivos existen (`/api/google/`) pero la integración no está conectada al dashboard.
14. **Recuperación limitada a preguntas de seguridad** — la interfaz ya funciona, evita revelar si una cuenta existe, limita intentos y usa tokens de un solo uso; para un servicio público convendría sustituirla por enlaces enviados por un canal verificado.
15. **Sin despliegue público** — el proyecto se ejecuta localmente; el adaptador de Node y el uso de SQLite con escrituras impiden usar hosting estático.

---

## 15. Plan de mejora por semana

### Semana 1 — Diagnóstico y arquitectura ✅

- Diagnóstico técnico del estado real del proyecto.
- Diagramas de arquitectura actual y objetivo.
- Registro de riesgos técnicos y deuda técnica.

### Semana 2 — API inteligente y contratos ✅

- Capacidad de IA expuesta como API consumible (`/api/v1/health`, `/api/v1/metadata`, `/api/v1/recommend`).
- Contrato de entrada/salida documentado, validación básica y manejo controlado de errores.
- Motor de IA (`aiEngine.js`) desacoplado de la base de datos y de la sesión de usuario.

### Semana 3 — Calidad y automatización

- ✅ **Pruebas automatizadas** con Vitest: 84 pruebas sobre API, autenticación,
  tareas, seguridad, migraciones SQLite/PostgreSQL, cifrado, cron, webhook,
  recordatorios, proveedores de IA, Google simulado, avatares y vinculación
  temporal de Telegram.
- ✅ **Pipeline CI/CD configurado** con GitHub Actions: PostgreSQL 16 efímero,
  migración, comprobación transaccional, cobertura y build, confirmado en una
  ejecución remota verde.
- ✅ **Esquema SQLite reproducible** mediante `npm run db:init`, sin ejecutar migraciones heredadas.
- ⬜ **Logging estructurado** de cada llamada a z.ai: modelo usado, tokens consumidos, latencia y si usó fallback.
- ⬜ **Sistema de feedback** (👍/👎) en las recomendaciones para medir la utilidad real del modelo.

> Nota: el plan original mencionaba Jest; se optó por **Vitest** por su compatibilidad nativa con ESM y Astro.

### Semana 4 — Contenedor y funciones inconclusas

- Contenedor Docker para el servidor web.
- Conectar Google Calendar al dashboard: importar eventos como tareas con fecha límite.
- Ampliar la recuperación con un canal verificado antes de considerar un uso público.
- Caché de recomendaciones: no volver a llamar a z.ai si la tarea no cambió.
- Pruebas de los endpoints que dependen de base de datos (SQLite en memoria).

### Semana 5 — Colaboración, limpieza y mejoras visuales

- Espacios de equipo: múltiples usuarios comparten un conjunto de tareas.
- Asignación de tareas a miembros del equipo.
- Notificaciones de Telegram cuando alguien modifica una tarea asignada.
- Limpieza de código muerto: módulos de Supabase sin uso y scripts de diagnóstico sueltos.
- Mejoras visuales del dashboard.

### Semana 6 — Despliegue y producción

- Migrar de SQLite a PostgreSQL para soportar concurrencia real.
- Ampliar el pipeline con despliegue automático.
- Desplegar en un servicio como Railway, Render o un VPS con dominio HTTPS propio.
- Versionamiento del prompt del sistema para rastrear cambios de calidad.

---

## 16. Documentación adicional

- [`docs/POSTGRESQL_DISENO_BLOQUE_2.md`](docs/POSTGRESQL_DISENO_BLOQUE_2.md) —
  diseño, diccionario, comandos, evidencia y límites de la migración PostgreSQL.
- [`docs/CIERRE_BLOQUE_2.md`](docs/CIERRE_BLOQUE_2.md) — resultados técnicos,
  QA de navegador, límites y puerta hacia el Bloque 3.
- [`docs/CIERRE_BLOQUE_3.md`](docs/CIERRE_BLOQUE_3.md) — suite ampliada,
  correcciones descubiertas, diseño de CI y evidencia de QA local.
- [`docs/QA_IA_LOCAL.md`](docs/QA_IA_LOCAL.md) — prueba real de z.ai, hallazgos
  de calidad, correcciones de RAG y límites pendientes.

| Documento | Contenido |
|---|---|
| [API inteligente](#7-api-inteligente) | Contratos de entrada, respuestas, validaciones y ejemplos de consumo |
| [`docs/pruebas-semana-3.md`](docs/pruebas-semana-3.md) | Mapa de pruebas: qué comportamientos se validan, por qué aportan valor y con qué datos |
| [`docs/registro-pruebas-semana-3.md`](docs/registro-pruebas-semana-3.md) | Registro de errores detectados, correcciones aplicadas y bloqueos técnicos abiertos |
| [`docs/CIERRE_BLOQUE_1.md`](docs/CIERRE_BLOQUE_1.md) | Evidencia del cierre de seguridad, actualización de dependencias y separación de credenciales de IA |

---

## 17. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework web | Astro 7.x (SSR con adaptador Node) |
| Base de datos | SQLite + better-sqlite3 |
| IA generativa | z.ai — GLM (`glm-4.5-flash`) |
| IA local (fallback) | Ollama + Llama 3.2 |
| Bot | Telegram Bot API |
| Autenticación | bcryptjs + JWT (jose) |
| Pruebas | Vitest 4 + @vitest/coverage-v8 |
| CI/CD | GitHub Actions |
| Runtime | Node.js 22.12 o posterior dentro de la línea 22 |
