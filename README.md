# NovaTareas Pro

Asistente personal inteligente de gestión de tareas con IA integrada. Diseñado para estudiantes y profesionales que necesitan organizar su carga de trabajo con ayuda de inteligencia artificial contextual.

---

## Requisitos previos

- Node.js 20 o superior
- Una API key de [Google AI Studio](https://aistudio.google.com/apikey) (gratuita)
- Un bot de Telegram creado con [@BotFather](https://t.me/BotFather)

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar migraciones de base de datos
node migrations/001_add_telefono_telegram.js
node migrations/002_add_overdue_notified.js
node migrations/003_task_history_and_comments.js

# 3. Configurar variables de entorno
cp .env.example .env
```

Abre `.env` y completa las variables:

```env
TELEGRAM_BOT_TOKEN=token_de_tu_bot
GEMINI_API_KEY=tu_api_key_de_google_ai
SECRET_KEY=cualquier_cadena_secreta
CRON_SECRET=otra_cadena_secreta
REMINDER_WINDOW_MINUTES=30
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
```

---

## Uso

```bash
# Desarrollo
npm run dev
# → http://localhost:4321

# Producción
npm run build && npm run start
```

### Configurar el bot de Telegram

Registra el webhook una sola vez (reemplaza con tu URL):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tu-dominio.com/api/telegram/webhook
```

En desarrollo local usa [ngrok](https://ngrok.com/) para exponer el servidor:

```bash
npx ngrok http 4321
```

### Activar recordatorios automáticos

Llama a este endpoint periódicamente (cada 5–15 minutos) para enviar recordatorios de vencimiento:

```bash
curl "http://localhost:4321/api/cron/reminders?secret=tu_cron_secret"
```

---

## Funcionalidades

### Gestión de tareas
- ✅ Registro e inicio de sesión seguro con bcrypt
- ✅ Crear, editar, completar, archivar y reabrir tareas
- ✅ **Prioridades**: Urgente / Alta / Media / Baja con indicadores visuales
- ✅ **Etiquetas y categorías** para organizar tareas
- ✅ **Fechas límite** con alertas visuales de vencimiento
- ✅ **Historial de cambios** automático por tarea (prioridad, fecha, estado)
- ✅ **Comentarios de progreso** sobre el avance de cada tarea
- ✅ **Calendario visual** mensual con tareas por fecha
- ✅ **Búsqueda y filtros avanzados** en tiempo real
- ✅ **Modo oscuro/claro** con persistencia
- ✅ Dashboard con estadísticas y progreso en tiempo real
- ✅ Diseño responsive para móvil y escritorio

### Inteligencia artificial (Google Gemini)
- 🤖 **Recomendaciones contextuales**: Gemini analiza la tarea, su historial de cambios y comentarios previos para generar sugerencias personalizadas
- 🤖 **Ayuda en comentarios**: al comentar el progreso de una tarea puedes pedir ayuda a la IA con todo el contexto acumulado
- 🤖 **Respuestas adaptadas al perfil**: las recomendaciones se ajustan según el tipo de usuario (estudiante, empleado o uso general)
- 🤖 **Sistema de fallback**: si Gemini no está disponible el sistema recurre a Ollama local o al historial de tareas archivadas del propio usuario

### Bot de Telegram
- 📱 **Vinculación de cuenta** con `/vincular`
- 📱 **Creación de tareas** conversacional con `/nuevatarea`
- 📱 **Recomendaciones de IA** con `/recomendacion`
- 📱 **Notificaciones proactivas**: nueva tarea, tarea completada, tarea urgente, recordatorio antes del vencimiento y alerta de tarea vencida

---

## Estructura del proyecto

```
novatareas-pro/
├── src/
│   ├── pages/
│   │   ├── dashboard.astro
│   │   └── api/
│   │       ├── tasks.js
│   │       ├── tasks/[id].js
│   │       ├── tasks/[id]/
│   │       │   ├── history.js
│   │       │   ├── comments.js
│   │       │   └── ai.js
│   │       ├── telegram/webhook.js
│   │       └── cron/reminders.js
│   └── lib/
│       ├── db.js
│       ├── auth.js
│       ├── telegramBot.js
│       └── telegramNotify.js
├── migrations/
├── .env.example
└── package.json
```

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework web | Astro 4.x (SSR) |
| Base de datos | SQLite + better-sqlite3 |
| IA generativa | Google Gemini 2.5 Flash |
| IA local (fallback) | Ollama + Llama 3.2 |
| Bot | Telegram Bot API |
| Autenticación | bcryptjs |
| Runtime | Node.js 20 |