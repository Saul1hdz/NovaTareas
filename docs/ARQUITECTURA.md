# Arquitectura de NovaTareas Pro

Este documento explica cómo está montado el sistema hoy, por qué está montado
así y qué tendría que pasar para cambiarlo. El README resume la misma
arquitectura en dos diagramas; aquí está el detalle que allí no cabe.

---

## 1. La forma general: un monolito modular

NovaTareas Pro es **una sola aplicación** que se despliega como una unidad, pero
por dentro está separada en capas con responsabilidades que no se mezclan.

```
        ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐
        │  Dashboard   │   │  Bot de      │   │  Cliente externo   │
        │  web (SSR)   │   │  Telegram    │   │  autorizado        │
        └──────┬───────┘   └──────┬───────┘   └─────────┬──────────┘
               │                  │                     │
               │ cookie firmada   │ webhook o polling   │ Bearer AI_API_KEY
               ▼                  ▼                     ▼
        ┌──────────────────────────────────────────────────────────┐
        │  src/middleware.js                                       │
        │  observabilidad (envuelve) → CSRF (rechaza)              │
        └──────────────────────────┬───────────────────────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Rutas HTTP — src/pages/api/                              │
        │  tareas · comentarios · historial · colaboración ·        │
        │  invitaciones · perfil · Google · Telegram · cron · v1/   │
        └──────────────────────────┬───────────────────────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Lógica de dominio — src/lib/                             │
        │  auth · csrf · security · collaboration · taskNudges ·    │
        │  emailVerification · dashboardStats · observability       │
        └───────────┬──────────────────────────────┬───────────────┘
                    ▼                              ▼
        ┌────────────────────────┐   ┌──────────────────────────────┐
        │  Capa de IA            │   │  Persistencia                │
        │  aiEngine.js · rag.js  │   │  src/db/ → PostgreSQL 16     │
        │  ai/providers.js       │   │  Drizzle + migraciones       │
        └───────────┬────────────┘   └──────────────────────────────┘
                    ▼
        z.ai (GLM) → Ollama → historial propio → reglas locales
```

### Qué hace cada capa

| Capa | Responsabilidad | Qué **no** hace |
|---|---|---|
| **Middleware** | Registrar cada solicitud y rechazar mutaciones de origen cruzado | No lee cuerpos ni cabeceras sensibles, no decide permisos |
| **Rutas** | Traducir HTTP a operaciones de dominio: leer el cuerpo, validar, responder | No contiene reglas de negocio ni SQL |
| **Dominio** (`src/lib/`) | Las reglas: quién puede qué, cuándo toca un recordatorio, cómo se valida una tarea | No sabe de HTTP ni de Astro |
| **IA** | Producir una recomendación a partir de datos ya normalizados | No accede a la base de datos ni conoce la sesión |
| **Persistencia** | SQL sobre PostgreSQL, transacciones, migraciones | No aplica reglas de negocio salvo las que el esquema garantiza |

Esa separación no es decorativa: `aiEngine.js` no toca la base de datos ni la
sesión, y por eso la misma capacidad se puede exponer como API externa
(`/api/v1/recommend`) sin arrastrar el modelo de usuarios detrás.

---

## 2. Las tres puertas de entrada

Las tres comparten base de datos y lógica; cambia solo cómo se autentican.

| Puerta | Autenticación | Dónde vive |
|---|---|---|
| **Dashboard web** | Cookie `novatareas_token` firmada (JWT), `HttpOnly`, `SameSite=Lax` | `src/pages/*.astro` |
| **Bot de Telegram** | Vinculación previa con código de un solo uso; el webhook exige `TELEGRAM_WEBHOOK_SECRET` | `telegram/bot.js`, `src/pages/api/telegram/` |
| **API externa** | Cabecera `Authorization: Bearer <AI_API_KEY>` | `src/pages/api/v1/` |

El cron de recordatorios es una cuarta entrada, sin usuario: se autentica con
`CRON_SECRET` y responde 401 sin él.

---

## 3. La cascada de IA

Es la decisión de diseño con más consecuencias del proyecto: **el servicio
siempre responde**, aunque todo lo de arriba falle.

```
1. z.ai (glm-4.5-flash)     ← primera opción, la de mejor calidad
2. Ollama local             ← si z.ai no responde o se agotó la cuota
3. Historial propio         ← recuperación semántica sobre tareas archivadas
4. Reglas locales           ← deterministas, sin red, siempre disponibles
```

Por eso `/api/v1/health` devuelve `200` incluso con z.ai y Ollama caídos: el
respaldo de reglas garantiza respuesta. Un `503` ahí significaría algo mucho
peor que quedarse sin cuota. La contrapartida honesta es que la calidad baja
escalón a escalón, y por eso cada recomendación guarda **de qué fuente salió**
(`zai`, `ollama`, `history`, `rules`).

---

## 4. Los datos

Diecisiete tablas en PostgreSQL 16, agrupadas por lo que sostienen:

| Grupo | Tablas |
|---|---|
| Identidad | `users`, `email_verification_tokens`, `recovery_tokens`, `security_questions` (heredada, ya sin uso) |
| Tareas | `tasks`, `subtasks`, `task_history`, `task_comments`, `categories` |
| Colaboración | `task_collaborators`, `task_invites` |
| Inteligencia | `task_recommendations`, `recommendation_feedback`, `task_embeddings` |
| Integraciones | `telegram_sessions`, `telegram_link_codes` |
| Defensa | `rate_limit_hits` |

Dos detalles que explican decisiones que de otro modo parecen arbitrarias:

- **`rate_limit_hits` está en la base y no en memoria** porque un contador en el
  proceso se reinicia con el contenedor y no sirve si mañana hay dos instancias.
- **`task_recommendations` está separada de `subtasks`** porque antes compartían
  tabla y una recomendación de la IA podía pisar los pasos que el usuario había
  escrito a mano.

---

## 5. Procesos que se despliegan

| Proceso | Qué hace | Puede escalar |
|---|---|---|
| `web` | Sirve el dashboard, la API y el webhook | Sí: no guarda estado en memoria |
| `db` | PostgreSQL 16 | Vertical; réplicas de lectura si hiciera falta |
| `migrate` | Aplica migraciones y termina | No aplica |
| `bot` (perfil opcional) | Bot de Telegram por polling | **No**: dos procesos con el mismo token se roban los mensajes |
| `scheduler` (perfil opcional) | Recordatorios por hora y recurrentes | No: duplicaría avisos |

Que `web` no guarde nada en memoria es lo que hace posible escalarlo: sesiones,
límites de intentos y estado del bot viven todos en PostgreSQL.

---

## 6. A dónde queremos llegar

```
Cliente Web / App Móvil
        ↓
API Gateway
  ├── Servicio de tareas      (Node.js + PostgreSQL)
  ├── Servicio de IA y RAG    (z.ai + base vectorial)
  ├── Servicio de notif.      (Node.js + cola)
  └── Servicio de auth        (JWT centralizado)
```

### Por qué todavía no

Un monolito modular es la elección correcta mientras el equipo sea de tres
personas y el tráfico quepa en una instancia. Partirlo ahora solo añadiría
latencia entre servicios, despliegues coordinados y errores de red donde hoy hay
una llamada a función.

**Lo que justificaría el corte**, por orden de probabilidad:

1. **La IA y las tareas necesitan escalas distintas.** Una recomendación tarda
   segundos y depende de un tercero; listar tareas tarda milisegundos. Cuando la
   IA empiece a agotar la instancia, se separa primero ella.
2. **El bot necesita ser varios procesos.** Eso exige pasar de polling a webhook
   con cola, que es exactamente el «servicio de notificaciones» del diagrama.
3. **Aparece un segundo cliente** (una app móvil) con necesidades de
   autenticación distintas de las del dashboard.

Mientras nada de eso pase, la frontera entre módulos ya está trazada dentro del
código: `src/lib/` no sabe de HTTP y la capa de IA no sabe de la base de datos.
Ese es justamente el trabajo previo que abarata el corte el día que toque.

---

## 7. Dónde seguir

- Contratos de la API: [`../api.md`](../api.md)
- Esquema y diccionario de datos: [`POSTGRESQL_DISENO_BLOQUE_2.md`](POSTGRESQL_DISENO_BLOQUE_2.md)
- Modelo de permisos: [`MODO_COLABORATIVO.md`](MODO_COLABORATIVO.md)
- Controles de seguridad: [`SEGURIDAD.md`](SEGURIDAD.md)
- Instrumentación y rendimiento: [`OBSERVABILIDAD_SEMANA_5.md`](OBSERVABILIDAD_SEMANA_5.md)
- Operación del servidor: [`DESPLIEGUE.md`](DESPLIEGUE.md)
