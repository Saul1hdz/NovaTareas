# ✦ NovaTareas Pro
**Asistente Personal Inteligente de Gestión de Tareas con IA**

**Universidad Gerardo Barrios — Módulo 4: Implementación y Escalabilidad**

---

## Integrantes

| Nombre | Carné |
|---|---|
| Saúl Oswaldo López Hernández | SMIS108421 |
| Moises Antonio Martínez | SMIS071221 |
| Enson Onan Carranza Rodríguez | SMIS013020 |

**Docente:** Ing. Marco Arévalo Zambrano

---

## 1. Problema que se desea resolver

Los estudiantes universitarios en El Salvador gestionan simultáneamente múltiples asignaturas, proyectos y responsabilidades personales. Una encuesta aplicada en febrero de 2026 a estudiantes de la UGB reveló que:

- **80%** califica la organización de tareas como difícil o muy difícil.
- **80%** olvida entregas al menos 1–3 veces por ciclo académico.
- **80–90%** reporta que la desorganización afecta negativamente sus calificaciones.

Las herramientas existentes (Todoist, Notion, Trello) son de pago, están en inglés y no incorporan IA contextual que aprenda del historial personal del usuario.

---

## 2. Usuarios o beneficiarios principales

- **Estudiantes universitarios** con alta carga académica.
- **Empleados** que gestionan múltiples proyectos simultáneos.
- Cualquier persona que necesite organización personal con asistencia de IA, sin pagar por herramientas externas.

---

## 3. Descripción general de la solución

NovaTareas Pro es una aplicación web full-stack con bot de Telegram integrado. El usuario accede por dos canales que comparten la misma base de datos y lógica:

- **Dashboard web** (Astro SSR): gestión visual de tareas con prioridades, calendario, historial de cambios y comentarios de progreso.
- **Bot de Telegram**: creación de tareas conversacional, recomendaciones de IA y notificaciones proactivas (tarea creada, completada, urgente, próxima a vencer, vencida).

El sistema registra automáticamente cada cambio realizado sobre una tarea (historial) y permite al usuario agregar notas de progreso. Toda esa información acumulada se usa como contexto para mejorar las respuestas de la IA con el tiempo.

---

## 4. Dónde está la inteligencia artificial

La IA vive en estos archivos concretos:

```
src/lib/aiEngine.js                 ← motor de recomendaciones reutilizable (API pública)
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
Busca las 5 tareas más similares del historial del usuario (similitud coseno, mínimo 0.25)
        ↓
Construye prompt con: tarea + tareas similares + historial de cambios + comentarios previos + tipo de usuario
        ↓
Envía a z.ai (GLM) → si falla → Ollama local → si falla → historial archivado → si falla → reglas locales
        ↓
Devuelve recomendación en español al dashboard o Telegram
```

---

## 5. Tipo de IA, modelo, servicio y técnica utilizada

| Componente | Detalle |
|---|---|
| **Modelo principal** | z.ai — GLM (`glm-4.5-flash`) |
| **Modelo de embeddings** | z.ai (`embedding-2` / `embedding-3`) con fallback Ollama `nomic-embed-text` |
| **Modelo local (fallback)** | Ollama + Llama 3.2:3b |
| **Técnica RAG** | Retrieval-Augmented Generation con similitud coseno |
| **Tipo de IA** | IA generativa (LLM) + búsqueda semántica |
| **NLP** | Implícito vía el modelo GLM (transformers internos) |
| **Sistema de fallback** | Cascada: z.ai → Ollama → historial → reglas locales |

> **Nota:** el proyecto migró de Google Gemini a z.ai (GLM). El código llama a la API de z.ai mediante `fetch` directo al endpoint `https://api.z.ai/api/paas/v4/chat/completions`, y el modelo se configura con la variable de entorno `ZAI_MODEL`.

---

## 6. Datos de entrada y salida esperados

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

## 7. API Inteligente (Semana 2)

La capacidad de IA se expone como servicio consumible desde cualquier cliente externo (curl, Postman, Swagger). Es independiente del dashboard: no requiere sesión ni que la tarea exista en la base de datos.

| Método | Ruta | Propósito |
|---|---|---|
| GET  | `/api/v1/health`    | Verificar que el servicio está activo. |
| GET  | `/api/v1/metadata`  | Versión, modelo, propósito y contrato. |
| POST | `/api/v1/recommend` | Generar una recomendación de productividad. |

**Ejemplo de uso:**
```bash
curl -X POST http://localhost:4321/api/v1/recommend \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Estudiar para el examen de cálculo","prioridad":"alta","tipo_usuario":"estudiante"}'
```

Contrato completo, validaciones y evidencia de prueba en [`docs/api.md`](docs/api.md).

---

## 8. Instalación y ejecución

### Requisitos previos
- Node.js 20 o superior
- API key de [z.ai](https://z.ai) (para las llamadas al modelo GLM)
- Bot de Telegram creado con [@BotFather](https://t.me/BotFather)
- (Opcional) [Ollama](https://ollama.com) con `nomic-embed-text` y `llama3.2:3b` para fallback local

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar entorno
cp .env.example .env
# Editar .env con tus claves reales (ver sección siguiente)

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
Necesitas una URL pública HTTPS. En desarrollo local usa ngrok:

```bash
npx ngrok http 4321
# Copia la URL que te da, ej: https://abc123.ngrok.io
```

Luego registra el webhook una sola vez:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://abc123.ngrok.io/api/telegram/webhook
```

### Qué es automático vs manual

| Acción | ¿Automático? |
|---|---|
| Instalar dependencias (`npm install`) | ✅ Automático |
| Crear tablas de BD | ⚠️ Manual — correr 4 scripts en orden |
| Iniciar servidor web | ✅ Un comando |
| Iniciar bot de Telegram | ⚠️ Manual — terminal separada |
| Iniciar scheduler | ⚠️ Manual — terminal separada |
| Registrar webhook de Telegram | ⚠️ Manual — una vez por instalación |
| Configurar variables de entorno | ⚠️ Manual — copiar y completar .env |

---

## 9. Variables de entorno requeridas

```env
# ── OBLIGATORIAS ──────────────────────────────────────────────
ZAI_API_KEY=             # API key de z.ai (sin esto la IA no funciona)
ZAI_MODEL=glm-4.5-flash  # Modelo de chat de z.ai
TELEGRAM_BOT_TOKEN=      # Token del bot de @BotFather (sin esto el bot no responde)
SECRET_KEY=              # Cadena secreta para firmar JWT (sin esto nadie puede iniciar sesión)

# ── IMPORTANTES ───────────────────────────────────────────────
CRON_SECRET=             # Protege el endpoint /api/cron/reminders
REMINDER_WINDOW_MINUTES=30   # Minutos de anticipación para recordatorios

# ── OPCIONALES (fallback local) ────────────────────────────────
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMB_MODEL=nomic-embed-text

# ── OPCIONALES (rate limiting de la API de IA) ─────────────────
AI_RATE_LIMIT_MAX=20         # Máx. peticiones por ventana
AI_RATE_LIMIT_WINDOW=300000  # Ventana en milisegundos (5 min)

# ── GOOGLE CALENDAR (en desarrollo) ───────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4321/api/google/callback
```

> ⚠️ El archivo `.env` **no está en el repositorio**. Si se pierde, hay que regenerar todas las claves manualmente.

---

## 10. Arquitectura

### Arquitectura actual (monolítica modular)

```
Usuario Web ──→ Dashboard Astro (SSR)
                      ↓
Usuario Telegram ──→ Webhook /api/telegram/webhook
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
  ├── Servicio de IA y RAG    (Python + vector DB)
  ├── Servicio de notif.      (Node.js + queue)
  └── Servicio de auth        (JWT centralizado)
```

---

## 11. Limitaciones conocidas del prototipo

1. **SQLite no soporta escrituras concurrentes** — el sistema es para uso individual o grupos pequeños; múltiples usuarios simultáneos pueden generar errores de lock.
2. **El bot y el scheduler requieren terminales manuales** — no hay un proceso único que los inicie todos.
3. **El estado de conversación del bot vive en memoria** — un reinicio del servidor cancela cualquier flujo de creación de tarea a medio completar.
4. **El webhook requiere URL pública** — en desarrollo local es necesario ngrok; si se cae, el bot deja de responder.
5. **Cuota de z.ai limitada** — el saldo/paquete de la cuenta puede agotarse; al fallar, el sistema cae al fallback local u offline.
6. **Sin pruebas automatizadas** — no hay tests unitarios ni de integración; los errores solo se detectan manualmente.
7. **RAG recién implementado** — los embeddings existen en la BD pero no todas las rutas del código los usan aún.
8. **Google Calendar en desarrollo** — los archivos existen (`/api/google/`) pero la integración no está conectada al dashboard.
9. **Sin recuperación de contraseña funcional** — el endpoint `auth/recover.js` existe pero no tiene interfaz de usuario.

---

## 12. Plan de mejora (semanas 2 a 6)

### Semana 2 — API inteligente y estabilización ✅
- Exponer la capacidad de IA como API consumible (`/api/v1/health`, `/api/v1/metadata`, `/api/v1/recommend`).
- Contrato de entrada/salida documentado, validación básica y manejo de errores.
- Conectar el RAG al flujo de recomendaciones del dashboard y el bot.

### Semana 3 — Calidad y observabilidad
- Logging estructurado de cada llamada a z.ai: modelo usado, tokens consumidos, latencia y si usó fallback.
- Sistema de feedback en recomendaciones (👍/👎) para evaluar la utilidad del modelo.
- Pruebas automatizadas con Jest para los endpoints críticos (`/api/v1/recommend`, `/api/tasks`, `/api/tasks/:id`).

### Semana 4 — Completar funciones inconclusas
- Conectar Google Calendar al dashboard: importar eventos como tareas con fecha límite.
- Implementar interfaz de recuperación de contraseña.
- Caché de recomendaciones: no volver a llamar a z.ai si la tarea no cambió desde la última consulta.

### Semana 5 — Colaboración básica, limpieza de código y mejoras en CSS
- Espacios de equipo: múltiples usuarios comparten un conjunto de tareas.
- Asignación de tareas a miembros del equipo.
- Notificaciones de Telegram cuando alguien del equipo modifica una tarea asignada.
- Limpieza del código: eliminar funciones o partes que no se usan o que solo sirvieron durante pruebas (por ejemplo, la tabla `categories` reemplazada por `label`, y scripts sueltos como `fix_categories.cjs`).
- Mejoras visuales para el proyecto.

### Semana 6 — Despliegue y producción
- Migrar de SQLite a PostgreSQL para soportar concurrencia real.
- Configurar CI/CD con GitHub Actions: lint, tests y despliegue automático.
- Desplegar en VPS (Railway, Render o DigitalOcean) con dominio HTTPS propio.
- Versionamiento del prompt del sistema para rastrear cambios de calidad en las respuestas del modelo.,