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

La IA vive en tres archivos concretos:

```
src/lib/rag.js                      ← genera embeddings y recupera tareas similares
src/pages/api/tasks/[id]/ai.js      ← endpoint de recomendaciones (dashboard)
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
Envía a Gemini 2.5 Flash → si falla → Ollama local → si falla → historial archivado → si falla → reglas locales
        ↓
Devuelve recomendación en español al dashboard o Telegram
```

---

## 5. Tipo de IA, modelo, servicio y técnica utilizada

| Componente | Detalle |
|---|---|
| **Modelo principal** | Google Gemini 2.5 Flash (`gemini-2.5-flash`) |
| **Modelo de embeddings** | Gemini `text-embedding-004` / Ollama `nomic-embed-text` |
| **Modelo local (fallback)** | Ollama + Llama 3.2:3b |
| **Técnica RAG** | Retrieval-Augmented Generation con similitud coseno |
| **Tipo de IA** | IA generativa (LLM) + búsqueda semántica |
| **NLP** | Implícito vía Gemini (transformers internos) |
| **Sistema de fallback** | Cascada: Gemini → Ollama → historial → reglas locales |

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
- Máximo 2048 tokens
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

## 7. Instalación y ejecución

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

## 8. Variables de entorno requeridas

```env
# ── OBLIGATORIAS ──────────────────────────────────────────────
ZAI_API_KEY=          # API key de Google AI Studio (sin esto la IA no funciona)
TELEGRAM_BOT_TOKEN=      # Token del bot de @BotFather (sin esto el bot no responde)
SECRET_KEY=              # Cadena secreta para firmar JWT (sin esto nadie puede iniciar sesión)

# ── IMPORTANTES ───────────────────────────────────────────────
CRON_SECRET=             # Protege el endpoint /api/cron/reminders
REMINDER_WINDOW_MINUTES=30   # Minutos de anticipación para recordatorios

# ── OPCIONALES (fallback local) ────────────────────────────────
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMB_MODEL=nomic-embed-text

# ── GOOGLE CALENDAR (en desarrollo) ───────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4321/api/google/callback
```

> ⚠️ El archivo `.env` **no está en el repositorio**. Si se pierde, hay que regenerar todas las claves manualmente.

---

## 9. Arquitectura

### Arquitectura actual (monolítica modular)

```
Usuario Web ──→ Dashboard Astro (SSR)
                      ↓
Usuario Telegram ──→ Webhook /api/telegram/webhook
                      ↓
              API Routes (src/pages/api/)
              tasks.js · [id].js · comments.js · ai.js
                      ↓
              Capa de inteligencia
              rag.js → Gemini API / Ollama → respuesta
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

## 10. Limitaciones conocidas del prototipo

1. **SQLite no soporta escrituras concurrentes** — el sistema es para uso individual o grupos pequeños; múltiples usuarios simultáneos pueden generar errores de lock.
2. **El bot y el scheduler requieren terminales manuales** — no hay un proceso único que los inicie todos.
3. **El estado de conversación del bot vive en memoria** — un reinicio del servidor cancela cualquier flujo de creación de tarea a medio completar.
4. **El webhook requiere URL pública** — en desarrollo local es necesario ngrok; si se cae, el bot deja de responder.
5. **Cuota de Gemini limitada** — la capa gratuita tiene límite de solicitudes por minuto; bajo carga alta cae al fallback.
6. **Sin pruebas automatizadas** — no hay tests unitarios ni de integración; los errores solo se detectan manualmente.
7. **RAG recién implementado** — los embeddings existen en la BD pero no todas las rutas del código los usan aún.
8. **Google Calendar en desarrollo** — los archivos existen (`/api/google/`) pero la integración no está conectada al dashboard.
9. **Sin recuperación de contraseña funcional** — el endpoint `auth/recover.js` existe pero no tiene interfaz de usuario.

---

## 11. Plan de mejora (semanas 2 a 6)

### Semana 2 — Estabilizar lo que existe
- Conectar el RAG al flujo completo de recomendaciones del dashboard y el bot.
- Agregar `node-cron` interno para que el scheduler corra automáticamente sin terminal separada.
- Persistir el estado de conversación del bot en SQLite en lugar de memoria.

### Semana 3 — Calidad y observabilidad
- Logging estructurado de cada llamada a Gemini: modelo usado, tokens consumidos, latencia y si usó fallback.
- Sistema de feedback en recomendaciones (👍/👎) para evaluar la utilidad del modelo.
- Pruebas automatizadas con Jest para los endpoints críticos (`/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/ai`).

### Semana 4 — Completar funciones inconclusas
- Conectar Google Calendar al dashboard: importar eventos como tareas con fecha límite.
- Implementar interfaz de recuperación de contraseña.
- Caché de recomendaciones: no volver a llamar a Gemini si la tarea no cambió desde la última consulta.

### Semana 5 — Colaboración básica, limpieza de codigo y mejoras en css
- Espacios de equipo: múltiples usuarios comparten un conjunto de tareas.
- Asignación de tareas a miembros del equipo.
- Notificaciones de Telegram cuando alguien del equipo modifica una tarea asignada.
- Limpieza de el codigo, eliminar funciones o partes de el codigo que no esten siendo utilizadas o que solo fueron utilizadas durante las pruebas y ya no afectan al rendimiento de el proyecto
- mejoras visuales para el proyecto 

### Semana 6 — Despliegue y producción
- Migrar de SQLite a PostgreSQL para soportar concurrencia real.
- Configurar CI/CD con GitHub Actions: lint, tests y despliegue automático.
- Desplegar en VPS (Railway, Render o DigitalOcean) con dominio HTTPS propio.
- Versionamiento del prompt del sistema para rastrear cambios de calidad en las respuestas de Gemini.