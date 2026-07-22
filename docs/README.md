# ✦ NovaTareas Pro

**Asistente Personal Inteligente de Gestión de Tareas con IA**

Universidad Gerardo Barrios — Módulo 4: Desarrollo de Aplicaciones con IA
Semana 1 — Diagnóstico y arquitectura inicial

---

## 1. Información general

**Nombre del equipo:** Equipo 3

**Integrantes:**

| Nombre | Carné |
|---|---|
| Saúl Oswaldo López Hernández | SMIS108421 |
| Moises Antonio Martínez | SMIS071221 |
| Enson Onan Carranza Rodríguez | SMIS013020 |

**Docente:** Ing. Marco Arévalo Zambrano

---

## 2. Descripción del problema

Los estudiantes universitarios en El Salvador gestionan simultáneamente múltiples asignaturas, proyectos y responsabilidades personales. Una encuesta aplicada en febrero de 2026 a estudiantes de la UGB reveló que:

- **80%** califica la organización de tareas como difícil o muy difícil.
- **80%** olvida entregas al menos 1–3 veces por ciclo académico.
- **80–90%** reporta que la desorganización afecta negativamente sus calificaciones.

Las herramientas existentes (Todoist, Notion, Trello) son de pago, están en inglés y no incorporan IA contextual que aprenda del historial personal del usuario.

---

## 3. Usuarios o beneficiarios

- **Estudiantes universitarios** con alta carga académica.
- **Empleados** que gestionan múltiples proyectos simultáneos.
- Cualquier persona que necesite organización personal con asistencia de IA, sin pagar por herramientas externas.

---

## 4. Descripción de la solución

NovaTareas Pro es una aplicación web full-stack con bot de Telegram integrado. El usuario accede por dos canales que comparten la misma base de datos y lógica:

- **Dashboard web** (Astro SSR): gestión visual de tareas con prioridades, calendario, historial de cambios y comentarios de progreso.
- **Bot de Telegram**: creación de tareas conversacional, recomendaciones de IA y notificaciones proactivas (tarea creada, completada, urgente, próxima a vencer, vencida).

El sistema registra automáticamente cada cambio realizado sobre una tarea (historial) y permite al usuario agregar notas de progreso. Esa información acumulada se usa como contexto para mejorar las respuestas de la IA con el tiempo.

---

## 5. Componente de inteligencia artificial

La IA vive en tres archivos concretos:

```
src/lib/rag.js                      ← genera embeddings y recupera tareas similares
src/pages/api/tasks/[id]/ai.js      ← endpoint de recomendaciones (dashboard)
src/lib/telegramBot.js              ← función getAiRecommendation (bot)
```

**Flujo de una recomendación:**

```
Usuario solicita consejo
        ↓
rag.js convierte la tarea en vector numérico (embedding)
        ↓
Busca las 5 tareas más similares del historial del usuario (similitud coseno, mínimo 0.25)
        ↓
Construye prompt con: tarea + tareas similares + historial de cambios + comentarios previos + tipo de usuario
        ↓
Envía a Gemini 2.5 Flash → si falla → Ollama local → si falla → historial archivado → si falla → reglas locales
        ↓
Devuelve recomendación en español al dashboard o Telegram
```

| Elemento | Detalle |
|---|---|
| Tipo de IA | IA generativa (LLM) + búsqueda semántica (RAG) |
| Modelo principal | Google Gemini 2.5 Flash (`gemini-2.5-flash`) |
| Modelo de embeddings | Gemini `text-embedding-004` / Ollama `nomic-embed-text` |
| Modelo local (fallback) | Ollama + Llama 3.2:3b |
| Datos de entrada | Tarea actual, historial de cambios, comentarios previos, top 5 tareas similares, tipo de usuario |
| Salida | Texto en español con recomendaciones prácticas (máx. 2048 tokens) |
| Evaluación | No hay métrica formal todavía; validación manual por el equipo |
| Limitaciones actuales | Cuota gratuita de Gemini limitada; RAG no está conectado en todas las rutas todavía |

### Entrada y salida esperadas

```
Entrada:  "preparar presentacion del proyecto de ventas" (Alta, 20 jun, tipo: empleado)
Salida:   "Divide la presentación en 3 bloques lógicos antes de redactar.
           Revisa presentaciones anteriores de tu historial para tomar estructura.
           Reserva 45 minutos hoy para el esqueleto inicial sin distracciones."
```

---

## 6. Estado actual del proyecto

Ver detalle completo en [`docs/diagnostico-semana-1.md`](docs/diagnostico-semana-1.md).

**Funciona:** autenticación, CRUD de tareas, historial y comentarios, dashboard, bot de Telegram, recomendaciones de IA con fallback en cascada.

**Incompleto:** integración con Google Calendar, recuperación de contraseña (endpoint sin interfaz), RAG no conectado en todas las rutas, migración a Supabase abandonada a medias.

---

## 7. Estructura del repositorio

```
novatareas-pro/
├── src/
│   ├── pages/
│   │   ├── dashboard.astro
│   │   └── api/
│   │       ├── tasks.js
│   │       ├── tasks/[id].js
│   │       ├── tasks/[id]/{history,comments,ai}.js
│   │       ├── auth/recover.js
│   │       ├── google/{auth,callback,events}.js
│   │       ├── telegram/webhook.js
│   │       └── cron/reminders.js
│   └── lib/
│       ├── db.js            # acceso a SQLite (activo)
│       ├── rag.js           # embeddings + recuperación semántica
│       ├── auth.js
│       ├── telegramBot.js
│       └── telegramNotify.js
├── telegram/                # bot.js y scheduler.js (procesos aparte)
├── migrations/
├── data/tareas_ejemplo.csv
├── docs/                    # diagnóstico y arquitectura (Semana 1)
├── .env.example
└── package.json
```

---

## 8. Instalación y ejecución

### Requisitos previos

- Node.js 20 o superior
- API key de [Google AI Studio](https://aistudio.google.com/apikey) (gratuita)
- Bot de Telegram creado con [@BotFather](https://t.me/BotFather)
- (Opcional) [Ollama](https://ollama.com) con `nomic-embed-text` y `llama3.2:3b` para fallback local

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar entorno
cp .env.example .env
# Editar .env con tus claves reales (ver sección de variables de entorno)

# 3. Ejecutar migraciones en orden
node migrations/001_add_telefono_telegram.js
node migrations/002_add_overdue_notified.js
node migrations/003_task_history_and_comments.js
node migrations/003_add_embeddings.cjs

# 4. Iniciar el servidor web
npm run dev
# → http://localhost:4321

# 5. Iniciar el bot de Telegram (terminal separada)
npm run bot:dev

# 6. Iniciar scheduler de recordatorios (terminal separada)
npm run bot:scheduler
```

### Registrar el webhook de Telegram

Se necesita una URL pública HTTPS. En desarrollo local se usa ngrok:

```bash
npx ngrok http 4321
```

Luego se registra el webhook una sola vez:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tu-dominio/api/telegram/webhook
```

### Variables de entorno

| Variable | Descripción | Obligatoria |
|---|---|---|
| `GEMINI_API_KEY` | API key de Google AI Studio; sin ella la IA no funciona | Sí |
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather; sin él el bot no responde | Sí |
| `SECRET_KEY` | Cadena secreta para firmar JWT de sesión | Sí |
| `CRON_SECRET` | Protege el endpoint `/api/cron/reminders` | Sí |
| `REMINDER_WINDOW_MINUTES` | Minutos de anticipación para recordatorios | No (default 30) |
| `OLLAMA_URL` / `OLLAMA_MODEL` / `OLLAMA_EMB_MODEL` | Fallback local de IA | No |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Integración con Google Calendar (en desarrollo, no conectada al dashboard) | No |

> ⚠️ El archivo `.env` no debe subirse al repositorio. El `.env.example` incluido en este proyecto contenía valores reales en vez de placeholders — ver `docs/riesgos-tecnicos.md`, deben rotarse antes de la entrega pública.

---

## 9. Arquitectura

Ver documentos completos:

- [`docs/arquitectura-actual.md`](docs/arquitectura-actual.md)
- [`docs/arquitectura-objetivo.md`](docs/arquitectura-objetivo.md)

---

## 10. Limitaciones conocidas

1. SQLite no soporta escrituras concurrentes — pensado para uso individual o grupos pequeños.
2. El bot y el scheduler requieren terminales manuales separadas del servidor web.
3. El estado de conversación del bot vive en memoria; un reinicio cancela flujos de creación de tarea a medio completar.
4. El webhook requiere URL pública (ngrok en desarrollo); si se cae, el bot deja de responder.
5. Cuota gratuita de Gemini limitada; bajo carga alta cae al fallback local u offline.
6. Sin pruebas automatizadas (no existe carpeta `tests/`).
7. RAG recién implementado: los embeddings existen en la BD pero no todas las rutas del código los usan aún.
8. Integración con Google Calendar sin conectar al dashboard.
9. Recuperación de contraseña sin interfaz de usuario.
10. Migración a Supabase iniciada (`src/lib/supabase.ts`, `supabase/schema.sql`) pero abandonada: los archivos están vacíos y el proyecto sigue operando sobre SQLite.

---

## 11. Plan de mejora (semanas 2 a 6)

Ver detalle completo en [`docs/plan-mejora.md`](docs/plan-mejora.md).

| Semana | Enfoque |
|---|---|
| 2 | Conectar RAG al flujo completo, mover scheduler a cron interno, persistir estado del bot |
| 3 | Logging de llamadas a Gemini, feedback de recomendaciones, pruebas con Jest |
| 4 | Google Calendar, recuperación de contraseña, caché de recomendaciones |
| 5 | Espacios de equipo, asignación de tareas, limpieza de código y mejoras visuales |
| 6 | Migración real a PostgreSQL, CI/CD, despliegue con dominio HTTPS |

---

## 12. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework web | Astro 4.x (SSR) |
| Base de datos | SQLite + better-sqlite3 |
| IA generativa | Google Gemini 2.5 Flash |
| IA local (fallback) | Ollama + Llama 3.2 |
| Bot | Telegram Bot API |
| Autenticación | bcryptjs + JWT (jose) |
| Runtime | Node.js 20 |
