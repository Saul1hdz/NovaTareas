# ✦ NovaTareas Pro

**Asistente Personal Inteligente de Gestión de Tareas con IA**

Universidad Gerardo Barrios — Módulo 4: Desarrollo de Aplicaciones con IA
Docente: Ing. Marco Arévalo Zambrano

> **Lee esto antes de instalar nada.** PostgreSQL 16 es el único motor de base de
> datos del proyecto. SQLite se retiró por completo: ya no queda driver,
> migraciones, importador ni capa de compatibilidad. Como las pruebas corren
> contra PostgreSQL real, `npm test` no funciona si el contenedor de la base de
>
> datos no está levantado.
>
> Si trabajas en **Windows con Docker Desktop**, empieza por
> [`docs/ENTORNO_WINDOWS.md`](docs/ENTORNO_WINDOWS.md): ahí están los tropiezos
> típicos y cómo evitarlos. El detalle de la migración está en
> [`docs/CIERRE_MIGRACION_POSTGRESQL.md`](docs/CIERRE_MIGRACION_POSTGRESQL.md) y
> el runbook del servidor en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

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

Un estudiante universitario en El Salvador lleva al mismo tiempo varias
asignaturas, proyectos de grupo y responsabilidades personales. Todo compite por
la misma cabeza y la misma agenda.

Aplicamos una encuesta en febrero de 2026 a estudiantes de la UGB y los números
fueron bastante claros:

- El **80%** dice que organizar sus tareas le resulta difícil o muy difícil.
- El **80%** olvida al menos una entrega, y hasta tres, en cada ciclo.
- Entre el **80% y el 90%** siente que esa desorganización le está bajando las
  notas.

Ya existen herramientas para esto —Todoist, Notion, Trello— pero cobran, están
pensadas en inglés y ninguna aprende del historial personal de quien las usa. Ahí
es donde entra NovaTareas.

---

## 2. Usuarios o beneficiarios

Pensamos el proyecto para tres perfiles:

- **Estudiantes universitarios** con mucha carga académica encima.
- **Personas que trabajan** llevando varios proyectos a la vez.
- **Cualquiera** que quiera organizarse con ayuda de IA sin tener que pagar una
  suscripción.

---

## 3. Descripción general de la solución

NovaTareas Pro es una aplicación web con un bot de Telegram integrado. Se puede
entrar por tres puertas distintas, pero todas comparten la misma base de datos y
la misma lógica de negocio:

- **El dashboard web** (Astro con renderizado en servidor), donde se gestionan
  las tareas de forma visual: prioridades, etiquetas, calendario, historial de
  cambios y comentarios de avance. Una tarea puede además compartirse mediante un
  enlace de invitación para trabajarla entre varias personas
  ([modo colaborativo](docs/MODO_COLABORATIVO.md)).
- **El bot de Telegram**, que permite crear tareas conversando, pedir
  recomendaciones de IA y recibir avisos automáticos cuando una tarea se crea, se
  completa, se vuelve urgente, está por vencer o ya venció.
- **Una API externa protegida**, que expone la capacidad inteligente como
  servicio REST para clientes autorizados mediante una API key propia.

Cada vez que alguien modifica una tarea, el sistema lo registra solo; además el
usuario puede ir dejando notas de progreso. Toda esa información se acumula y
después se usa como contexto para que las recomendaciones de la IA mejoren con el
tiempo en lugar de responder siempre lo mismo.

---

## 4. Dónde está la inteligencia artificial

Si quieres ver el código de la IA, está en estos archivos:

```
src/lib/aiEngine.js                 ← motor de recomendaciones reutilizable
src/lib/rag.js                      ← genera embeddings y recupera tareas similares
src/lib/ai/providers.js             ← define la cascada z.ai → Ollama → reglas
src/pages/api/tasks/[id]/ai.js      ← endpoint de recomendaciones (dashboard)
src/pages/api/v1/recommend.js       ← endpoint de IA para clientes externos
src/lib/telegramBot.js              ← función getAiRecommendation (bot)
src/pages/api/tasks/[id]/feedback.js ← valoración útil/no útil de cada recomendación
src/lib/recommendationFeedback.js   ← recupera esa valoración para el próximo prompt
```

Así es como viaja una recomendación de principio a fin:

```
El usuario pide un consejo
        ↓
rag.js convierte la tarea en un vector numérico (embedding)
        ↓
Busca las 5 tareas más parecidas del historial de ese usuario
(similitud coseno, con un umbral mínimo de 0.25)
        ↓
Arma el prompt juntando: la tarea + esas tareas similares + su historial
de cambios + los comentarios previos + el tipo de usuario
        ↓
Lo envía a z.ai (GLM) → si falla → Ollama local → si falla → historial
archivado → si falla → reglas locales
        ↓
Devuelve la recomendación en español al dashboard, a Telegram o a la API
```

### La recomendación aprende de lo que dices de ella

Cada recomendación tiene un botón **Utilidad** en su tarjeta. Abre una ventana
con dos pulgares y una caja de texto para explicar el porqué:

```
El usuario marca 👍 o 👎 y escribe por qué
        ↓
Se guarda en recommendation_feedback, ligada a esa recomendación y a esa persona
        ↓
Al pedir otra recomendación —desde «Utilidad» o desde «Consejos»— el prompt
incluye lo que se dijo: qué consejo se descartó y con qué motivo
        ↓
La IA recibe la orden de proponer algo DISTINTO que corrija lo señalado
```

El comentario **sobrevive al archivado**: cuando la tarea se cierra, lo aprendido
sigue disponible como contexto de largo plazo y entra en las recomendaciones de
tareas parecidas, identificado con el título de la tarea de la que salió.

Cada persona valora la recomendación que pidió. En una tarea compartida, nadie ve
ni puntúa el consejo de otro, por la misma razón por la que no ve su contenido:
puede derivarse de su historial privado.

Esa **cascada de respaldos** no es un adorno: es una decisión de diseño
importante. Garantiza que el usuario reciba siempre algo útil aunque no haya
internet, aunque se acabe el saldo de la API o aunque nadie tenga Ollama
instalado.

---

## 5. Modelo, servicio y técnica utilizada

| Componente | Detalle |
|---|---|
| **Modelo principal** | z.ai — GLM (`glm-4.5-flash`) |
| **Modelo de embeddings** | z.ai (`embedding-2` / `embedding-3`), con respaldo en Ollama `nomic-embed-text` |
| **Modelo local (respaldo)** | Ollama + Llama 3.2:3b |
| **Técnica RAG** | Retrieval-Augmented Generation con similitud coseno |
| **Tipo de IA** | IA generativa (LLM) combinada con búsqueda semántica |
| **NLP** | Implícito, a través del modelo GLM y sus transformers internos |
| **Sistema de respaldo** | Cascada: z.ai → Ollama → historial → reglas locales |
| **Evaluación** | Validación manual del equipo; falta una métrica formal de utilidad |

> **Sobre el cambio de proveedor:** el proyecto arrancó usando Google Gemini y
> después migramos a z.ai (GLM) por disponibilidad y costo. El código llama a la
> API con un `fetch` directo al endpoint
> `https://api.z.ai/api/paas/v4/chat/completions`, así que ya no depende de
> ningún SDK de Google. El modelo se elige con la variable `ZAI_MODEL`.

---

## 6. Datos de entrada y salida

### Qué recibe el modelo

```
- Título de la tarea (texto libre)
- Descripción de la tarea (texto libre, opcional)
- Prioridad actual: urgente | alta | media | baja
- Fecha límite (YYYY-MM-DD, opcional)
- Tipo de usuario: estudiante | empleado | comun
- Historial de cambios de la tarea (campo, valor anterior, valor nuevo, fecha)
- Comentarios de progreso anteriores (hasta 10)
- Las 5 tareas más parecidas del historial del usuario (traídas por RAG)
```

### Qué devuelve

```
- Texto en español con recomendaciones concretas
- Oraciones cortas separadas por punto, unas 130 palabras como máximo
- Texto plano con Markdown, que se convierte a HTML para Telegram
- Sin introducciones genéricas: responde directamente al contexto de la tarea
```

### Un ejemplo real

```
Entrada:  "preparar presentacion del proyecto de ventas" (Alta, 20 jun, tipo: empleado)

Salida:   "Divide la presentación en 3 bloques lógicos antes de redactar.
           Revisa presentaciones anteriores de tu historial para tomar estructura.
           Reserva 45 minutos hoy para el esqueleto inicial sin distracciones."
```

---

## 7. API inteligente

La capacidad de IA también se expone como servicio REST, para poder consumirla
desde cualquier cliente externo: curl, Postman, Swagger o lo que sea. Es
**independiente del dashboard**, o sea que no necesita sesión iniciada ni que la
tarea exista antes en la base de datos.

| Método | Ruta | Para qué sirve |
|---|---|---|
| GET  | `/api/v1/health`    | Comprobar que el servicio responde. |
| GET  | `/api/v1/metadata`  | Consultar versión, modelo, propósito y contrato. |
| POST | `/api/v1/recommend` | Pedir una recomendación de productividad. |

### Qué acepta `POST /api/v1/recommend`

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `titulo` | string | **Sí** | No puede ir vacío, máximo 200 caracteres |
| `descripcion` | string | No | Máximo 1000 caracteres |
| `prioridad` | string | No | `baja` \| `media` \| `alta` \| `urgente` (por defecto `media`) |
| `tipo_usuario` | string | No | `comun` \| `estudiante` \| `empleado` (por defecto `comun`) |
| `fecha_limite` | string | No | Formato `YYYY-MM-DD` |

### Cómo se usa

```bash
curl -X POST http://localhost:4321/api/v1/recommend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_API_KEY" \
  -d '{"titulo":"Estudiar para el examen de cálculo","prioridad":"alta","tipo_usuario":"estudiante"}'
```

Si todo va bien responde **200**:

```json
{
  "recomendacion": "Empieza por dividir el temario en 3 bloques...",
  "fuente": "zai",
  "tarea": { "titulo": "...", "prioridad": "alta", "tipo_usuario": "estudiante" }
}
```

Y si algo falta o está mal, responde **400**:

```json
{ "error": "El campo \"titulo\" es obligatorio y no puede estar vacío." }
```

Fíjate en el campo `fuente`: te dice qué motor generó realmente esa respuesta,
que puede ser `zai`, `ollama` o `rules`. Es la forma de saber si la IA respondió
o si entró el respaldo.

El contrato completo, con todas las validaciones, códigos de error y evidencia de
prueba, está en **[`/api.md`](/api.md)**.

---

## 8. Pruebas automatizadas

Usamos **Vitest** en lugar de Jest porque entiende módulos ESM de forma nativa y
se lleva bien con el ecosistema de Astro, que es justo lo que necesitábamos.

### Comandos

```bash
npm test              # correr todas las pruebas una vez
npm run test:watch    # modo observador: se relanzan al guardar
npm run test:coverage # con reporte de cobertura
npm run lint          # revisar tipos y sintaxis del proyecto
```

### Qué se prueba

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `tests/aiEngine.test.js` | 14 | Validación de entrada: títulos vacíos o larguísimos, descripciones fuera de límite, prioridades inventadas, fechas mal escritas y cuerpos que ni siquiera son un objeto |
| `tests/api.test.js` | 13 | Los endpoints `/api/v1/health`, `/api/v1/metadata` y `/api/v1/recommend`, incluida la autenticación de la API externa |
| `tests/appFlows.test.js` | 14 | Registro, login, logout, cambio de contraseña, ciclo de vida de una tarea, ownership, subtareas, historial, comentarios y vinculación con Telegram |
| `tests/security.test.js` | 8 | Sesiones, cookies, límites de intentos persistidos, secretos, logs seguros y el `state` de Google OAuth |
| `tests/taskValidation.test.js` | 3 | Validación de tareas, fechas, estados, etiquetas y comentarios |
| `tests/integrationSecurity.test.js` | 8 | Cron, webhook de Telegram simulado y subida de avatares válidos, falsificados o con MIME incorrecto |
| `tests/postgresSchema.test.js` | 7 | Esquema, restricciones y reejecución de las migraciones de PostgreSQL usando PGlite |
| `tests/tokenEncryption.test.js` | 3 | Cifrado, descifrado y rechazo de tokens alterados |
| `tests/reminders.test.js` | 7 | Zona horaria, avisos que no se repiten, ausencia de marcación cuando Telegram falla y programación de `reminder_at` |
| `tests/aiProviders.test.js` | 3 | z.ai, Ollama y el respaldo local, con la red simulada |
| `tests/aiPrompt.test.js` | 3 | Que el prompt no invente antecedentes y trate el RAG como evidencia opcional |
| `tests/aiRecommendations.test.js` | 4 | Que las recomendaciones no borren subtareas, se guarden aparte y dejen registrado su origen |
| `tests/googleIntegration.test.js` | 4 | OAuth, eventos, renovación y guardado cifrado de tokens, con Google simulado |
| `tests/telegramSessions.test.js` | 5 | Que el estado de la conversación del bot persista, caduque y no se quede con las tareas del usuario |
| `tests/dashboardStats.test.js` | 4 | Conteos del panel, tipos numéricos y etiquetas visibles |
| `tests/noSqliteDialect.test.js` | 3 | Que nadie vuelva a introducir dialecto SQLite en el código |

**En total son 103 pruebas**, todas contra **PostgreSQL 16 real**, el mismo motor
que se despliega. Al arrancar, la suite recrea el esquema desde las migraciones
en la base que indique `TEST_DATABASE_URL`, y ese nombre tiene que terminar en
`_test`. Por eso `npm test` necesita el contenedor de base de datos encendido. El
esquema se verifica además con PGlite, y en CI se levanta un PostgreSQL 16
efímero.

### Cómo están hechas

Las pruebas de endpoints siguen la misma idea que el `TestClient` de FastAPI: en
lugar de levantar el servidor y lanzarle peticiones desde fuera, **importan
directamente el handler y le pasan un objeto `Request`**. No hace falta abrir
ningún puerto ni que alguien esté ahí haciendo clic.

### Por qué no llamamos a servicios reales

Las pruebas **nunca llaman a z.ai, Ollama, Telegram ni Google de verdad**. Todos
se simulan de forma controlada, y los casos offline fuerzan a propósito las
reglas locales. Las credenciales del entorno de pruebas son ficticias.

Hacerlo así nos da tres cosas:

1. Las pruebas son **deterministas**: el mismo resultado siempre.
2. **No gastan saldo** de la API cada vez que alguien las corre.
3. **No fallan** porque se cayó la red o se agotó la cuota.

El mapa completo de pruebas —qué comportamiento valida cada una y por qué vale la
pena— está en **[`docs/pruebas-semana-3.md`](docs/pruebas-semana-3.md)**. Los
errores que fuimos encontrando, cómo los corregimos y qué quedó bloqueado están
en **[`docs/registro-pruebas-semana-3.md`](docs/registro-pruebas-semana-3.md)**.

---

## 9. Integración continua (CI/CD)

Cada `push` y cada `pull request` disparan el workflow de
`.github/workflows/ci.yml` en GitHub Actions, que hace lo siguiente:

1. Descarga el repositorio (`actions/checkout`).
2. Configura Node.js 22.12 con caché de npm.
3. Instala dependencias con `npm ci`, reproducible desde `package-lock.json`.
4. Revisa tipos y sintaxis con `npm run lint`.
5. Levanta un PostgreSQL 16 efímero, migra y comprueba el esquema.
6. Corre las 103 pruebas con cobertura (`npm run test:coverage`).
7. Guarda el reporte de cobertura como artefacto durante 14 días.
8. Compila el proyecto (`npm run build`).

El workflow **no expone `ZAI_API_KEY` ni ninguna credencial real**: las pruebas
usan secretos ficticios, no consumen saldo y cualquier fallo importante detiene
el job. Quedó confirmado funcionando sobre la rama `testing` en la
[ejecución 30121273529](https://github.com/Saul1hdz/NovaTareas/actions/runs/30121273529).

---

## 10. Instalación y ejecución

Hay dos formas de levantar el proyecto. **Si vas a trabajar en equipo, usa
Docker**: evita que las diferencias de versión de Node entre computadoras se
conviertan en errores raros. La ejecución nativa queda para quien ya tenga el
entorno afinado.

### Lo que necesitas antes de empezar

- Node.js `>=22.12.0 <23.0.0`, que es la versión que fija `.nvmrc`.
- Docker con Compose, si vas por el camino recomendado.
- Una API key de [z.ai](https://z.ai) para el modelo `glm-4.5-flash`.
- Un bot de Telegram creado con [@BotFather](https://t.me/BotFather), solo si vas
  a probar esa parte.
- Opcionalmente, [Ollama](https://ollama.com) con `nomic-embed-text` y
  `llama3.2:3b` si quieres probar el respaldo local.

### Opción A — Con Docker (recomendada)

Este es el camino corto. Un solo comando levanta PostgreSQL, espera a que esté
sano, aplica las migraciones y recién entonces arranca la web:

```bash
cp .env.example .env
# Abre .env y completa solo lo que vayas a probar.

docker compose -f compose.dev.yml up -d --build web
```

La aplicación queda en `http://127.0.0.1:4321` y PostgreSQL en
`127.0.0.1:5434`. Para ver el estado:

```bash
docker compose -f compose.dev.yml ps
```

Una comprobación funcional de extremo a extremo:

```bash
docker compose -f compose.dev.yml exec web npm run db:pg:smoke
```

El bot y el planificador **no arrancan solos**, están detrás de perfiles. Ojo con
el bot: solo puede haber una instancia con el mismo token en todo el equipo, así
que pregunta antes de encenderlo.

```bash
docker compose -f compose.dev.yml --profile telegram up -d bot
docker compose -f compose.dev.yml --profile scheduler run --rm scheduler
```

### Recordatorios recurrentes por prioridad

El planificador envía tres cosas distintas por Telegram:

| Aviso | Cuándo | Cuántas veces |
|---|---|---|
| Recordatorio de vencimiento | Antes de `reminder_at` | Una |
| Alerta de vencida | Al pasar la fecha límite | Una |
| **Recordatorio recurrente** | Mientras la tarea siga sin completarse | Repetido, según prioridad |

El recurrente insiste cada 1 h en las urgentes, 3 h en las altas, 5 h en las
medias y 6 h en las bajas. Deja de escribir cuando la tarea se completa o se
archiva, y no molesta entre las 22:00 y las 07:00.

**Viene apagado.** Se enciende con `TASK_NUDGES_ENABLED=true`, y los intervalos
y la franja de silencio se ajustan con las variables de `.env.example`. Está
apagado a propósito: el bot de producción escribe a personas reales y activarlo
es una decisión que debe tomar alguien, no un efecto de desplegar.

Como el planificador se ejecuta una vez y termina, para que los avisos horarios
funcionen hay que dispararlo al menos cada hora: con `cron` llamando al perfil
de Compose, o con una petición a `/api/cron/reminders` autenticada con
`CRON_SECRET`.

Para apagar todo sin perder datos:

```bash
docker compose -f compose.dev.yml --profile telegram --profile scheduler down
```

> **No uses `down -v`.** Ese flag borra los volúmenes, y con ellos se va la base
> de datos, las dependencias del contenedor y los avatares subidos.

### Opción B — Ejecución nativa

```bash
# 1. Usar Node 22 e instalar exactamente lo que dice el lockfile
nvm use 22
npm ci

# 2. Configurar el entorno
cp .env.example .env
# Edita .env con tus claves reales (ver la sección de variables)

# 3. Levantar PostgreSQL y aplicar las migraciones
docker compose -f compose.dev.yml up -d db
npm run db:pg:migrate

# 4. Iniciar el servidor web → http://localhost:4321
npm run dev

# 5. En otra terminal, el bot de Telegram
npm run bot:dev

# 6. En otra más, el planificador de recordatorios
npm run bot:scheduler
```

Aun en modo nativo necesitas Docker para la base de datos: PostgreSQL es
obligatorio y `DATABASE_URL` tiene que apuntar al que publica Compose.

### Antes de correr las pruebas

La suite necesita su propia base de datos. **Créala una sola vez:**

```bash
docker compose -f compose.dev.yml exec db createdb -U novatareas novatareas_test
```

Si la ejecutas de nuevo verás `database "novatareas_test" already exists`. Ese
error es esperado, ignóralo. Después ya puedes correr:

```bash
npm test
npm run db:pg:verify
```

Y si quieres datos ficticios para una demostración:

```bash
npm run db:seed
```

### Registrar el webhook de Telegram

Solo hace falta si vas a usar webhook en lugar de polling, y necesitas una URL
pública con HTTPS. En local se resuelve con ngrok:

```bash
npx ngrok http 4321
# Copia la URL que te devuelve, por ejemplo https://abc123.ngrok.io
```

Después registras el webhook una sola vez, abriendo esta dirección en el
navegador:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://abc123.ngrok.io/api/telegram/webhook
```

### Qué se hace solo y qué te toca a ti

| Acción | ¿Automático? |
|---|---|
| Instalar dependencias (`npm ci`) | ✅ Sí, con Node 22.12 o posterior |
| Crear las tablas (`npm run db:pg:migrate`) | ✅ Sí, el migrador es transaccional e idempotente |
| Correr las pruebas (`npm test`) | ✅ Sí |
| Validar cada push (GitHub Actions) | ✅ Sí |
| Levantar el servidor web | ✅ Un solo comando |
| Levantar el bot de Telegram | ⚠️ Manual, en una terminal aparte |
| Levantar el planificador | ⚠️ Manual, en una terminal aparte |
| Registrar el webhook de Telegram | ⚠️ Manual, una vez por instalación |
| Configurar las variables de entorno | ⚠️ Manual, copiar y completar `.env` |

---

## 11. Variables de entorno

No necesitas llenar el archivo entero. Para probar la aplicación, z.ai y el bot
de Telegram por polling, **basta con estas cinco**:

```env
SECRET_KEY=                 # Secreto aleatorio para firmar las sesiones
ZAI_API_KEY=                # Tu credencial de z.ai
ZAI_MODEL=glm-4.5-flash
ZAI_EMB_ENABLED=false       # Dejar en false: no probamos embeddings de z.ai aún
TELEGRAM_BOT_TOKEN=         # El token que te da @BotFather
```

Con eso, `npm run dev` levanta la web y `npm run bot:dev` levanta el bot en otra
terminal. El modo polling no pide `TELEGRAM_WEBHOOK_SECRET`, ni URL pública, ni
túnel HTTPS.

El resto de variables están marcadas como opcionales en `.env.example` y solo hay
que descomentarlas cuando vayas a probar esa función concreta: webhook y cron,
API externa de recomendaciones, Ollama o Google Calendar. `GEMINI_API_KEY` es
herencia de unas herramientas manuales de embeddings; no la necesitas para nada
del flujo actual.

Dos variables merecen atención especial:

- **`DATABASE_URL` es obligatoria.** PostgreSQL es el único motor soportado y sin
  ella la aplicación ni siquiera arranca. Si usas `compose.dev.yml`, él la define
  internamente y no tienes que tocarla.
- **`TEST_DATABASE_URL` debe terminar en `_test`.** El arranque de las pruebas
  borra el esquema completo de esa base en cada ejecución, así que el código se
  niega a apuntar a cualquier otra cosa. Es una red de seguridad para que nadie
  borre sin querer sus datos de desarrollo.

> ⚠️ `.env` y `.env.local` **no se versionan**, están en `.gitignore`. El que sí
> se versiona es `.env.example`, y solo tiene placeholders. No pases tu `.env`
> real por chat ni reutilices los secretos locales en el servidor.

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
│   │       ├── v1/health/ready.js                  # sonda que consulta la BD
│   │       ├── tasks.js
│   │       ├── tasks/[id].js
│   │       ├── tasks/[id]/{history,comments,ai}.js
│   │       ├── tasks/[id]/{collaborators,invites}.js  # modo colaborativo
│   │       ├── invites/accept.js                      # canje del enlace
│   │       ├── auth/recover.js
│   │       ├── google/{auth,callback,events}.js
│   │       ├── telegram/webhook.js
│   │       └── cron/reminders.js
│   └── lib/
│       ├── ai/providers.js    # z.ai y Ollama: la cascada definida una sola vez
│       ├── aiEngine.js        # motor de IA reutilizable, sin BD ni sesión
│       ├── rag.js             # embeddings y recuperación semántica
│       ├── db.js              # helpers de dominio sobre PostgreSQL
│       ├── auth.js            # JWT por cookie o Bearer token
│       ├── appTime.js         # criterio único de fecha y zona horaria
│       ├── dashboardStats.js  # consultas del panel, con pruebas propias
│       ├── collaboration.js   # niveles, invitaciones y canje de enlaces
│       ├── routeParams.js     # normaliza los identificadores de la ruta
│       ├── security.js        # límites de intentos persistidos en PostgreSQL
│       ├── telegramBot.js
│       └── telegramNotify.js
├── src/db/
│   ├── client.js            # envoltorio fino sobre pg, no traduce el SQL
│   └── postgres/            # esquema, cliente y repositorios de Drizzle
├── tests/                   # 23 archivos, 129 pruebas contra PostgreSQL real
├── telegram/                # bot.js y scheduler.js, procesos aparte
├── migrations/postgresql/   # migraciones versionadas generadas con Drizzle
├── scripts/                 # migrar, verificar, sembrar y smoke test
├── compose.dev.yml          # web, migraciones, PostgreSQL y perfiles del bot
├── compose.prod.yml         # despliegue: target runtime, sin puertos abiertos
├── Dockerfile               # targets development y runtime, sobre Node 22
├── data/tareas_ejemplo.csv
├── api.md                   # contratos de la API
├── docs/
│   ├── DESPLIEGUE.md                # runbook del servidor
│   ├── ENTORNO_WINDOWS.md           # Docker Desktop en Windows
│   ├── CIERRE_MIGRACION_POSTGRESQL.md
│   └── pruebas-semana-3.md          # mapa de pruebas
├── .env.example
├── .gitattributes           # fuerza finales de línea LF para los contenedores
├── vitest.config.js
├── astro.config.mjs
└── package.json
```

---

## 13. Arquitectura

### Cómo está hoy (monolito modular)

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
                  PostgreSQL 16 (en Docker)
                  users · tasks · task_history · task_comments · task_embeddings
```

PostgreSQL 16 es el único motor y no hay vuelta atrás a otro sistema. Si algo se
rompe, la recuperación se hace restaurando una copia de `pg_dump` siguiendo el
procedimiento de [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

### A dónde queremos llegar (microservicios)

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

Preferimos decirlas de frente antes de que sorprendan a alguien:

1. **Hace falta un PostgreSQL levantado para todo**, incluso para correr las
   pruebas. Docker Compose es la forma recomendada de tenerlo.
2. **El bot y el planificador son procesos separados.** En Docker están detrás de
   perfiles opcionales, justamente para no arrancar dos bots por accidente.
3. **El estado de conversación del bot vive en la tabla `telegram_sessions`** y
   caduca a los 15 minutos. Sobrevive a un reinicio, pero una conversación
   abandonada se pierde al caducar.
4. **El webhook necesita una URL pública.** En local eso significa ngrok, y si el
   túnel se cae el bot deja de responder. Por eso en desarrollo usamos polling.
5. **La cuota de z.ai es limitada.** Cuando se agota el saldo, el sistema cae al
   respaldo local u offline en lugar de fallar.
6. **La cobertura de pruebas todavía tiene huecos.** Las 103 pruebas ya cubren
   autenticación, recuperación, ownership, tareas, migraciones de PostgreSQL,
   cifrado de tokens, recordatorios, cron, webhook, avatares, códigos de
   vinculación de Telegram, proveedores de IA y las rutas principales de Google
   simuladas. Falta cubrir a fondo la conversación del bot, el RAG y el flujo
   visual de Google en el dashboard.
7. **El RAG está conectado solo a medias.** Los embeddings existen en la base de
   datos, pero no todas las rutas del código los consumen todavía.
8. **No hay métrica formal de calidad.** Falta un sistema de feedback que mida si
   las recomendaciones realmente sirven.
9. **No hay logging estructurado.** Las llamadas al modelo no registran qué modelo
   se usó, cuántos tokens consumió ni cuánto tardó.
10. **Una sola instancia de web y una de bot.** Los límites de intentos, los
    tokens de recuperación y las sesiones del bot ya se comparten a través de
    PostgreSQL, así que la web podría escalar; el bot no, porque usa polling y
    dos procesos con el mismo token se roban los mensajes.
11. **El dashboard sigue siendo un archivo monolítico.**
    `src/pages/dashboard.astro` pasa de las 2.800 líneas. Su acceso a datos ya se
    extrajo a `src/lib/dashboardStats.js`, pero el CSS y el JavaScript de cliente
    siguen sin separar.
12. **Google Calendar está a medio camino.** Los archivos existen en
    `/api/google/`, pero la integración aún no está conectada al dashboard.
13. **La recuperación de cuenta se basa en preguntas de seguridad.** Ya funciona
    bien: no revela si una cuenta existe, limita intentos y usa tokens de un solo
    uso. Aun así, para un servicio público habría que sustituirla por enlaces
    enviados a un canal verificado.
14. **Todavía no hay despliegue público.** El proyecto corre en local; Netcup,
    dominio, HTTPS y operación continua quedan para el final. El runbook ya está
    escrito en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

---

## 15. Plan de mejora por semana

### Semana 1 — Diagnóstico y arquitectura ✅

- Diagnóstico técnico del estado real del proyecto.
- Diagramas de la arquitectura actual y de la objetivo.
- Registro de riesgos y deuda técnica.

### Semana 2 — API inteligente y contratos ✅

- Capacidad de IA expuesta como API consumible (`/api/v1/health`,
  `/api/v1/metadata`, `/api/v1/recommend`).
- Contrato de entrada y salida documentado, con validación y manejo controlado de
  errores.
- Motor de IA (`aiEngine.js`) desacoplado de la base de datos y de la sesión.

### Semana 3 — Calidad y automatización

- ✅ **Pruebas automatizadas** con Vitest: 103 casos sobre API, autenticación,
  tareas, seguridad, migraciones, cifrado, cron, webhook, recordatorios,
  proveedores de IA, Google simulado, avatares y vinculación de Telegram.
- ✅ **Pipeline de CI/CD** en GitHub Actions con PostgreSQL 16 efímero,
  migración, comprobación transaccional, cobertura y build. Confirmado en verde
  en una ejecución remota.
- ✅ **Esquema de PostgreSQL reproducible** con `npm run db:pg:migrate`,
  versionado con Drizzle.
- ⬜ **Logging estructurado** de cada llamada a z.ai: modelo, tokens, latencia y
  si entró el respaldo.
- ⬜ **Sistema de feedback** (👍/👎) en las recomendaciones, para medir si de
  verdad sirven.

> El plan original mencionaba Jest. Nos pasamos a **Vitest** porque entiende ESM
> y Astro de forma nativa.

### Semana 4 — PostgreSQL y contenedores ✅

- ✅ Contenedor Docker con Node 22 para web, PostgreSQL y migraciones.
- ✅ Perfiles separados para el bot de Telegram y el planificador.
- ✅ Migración completa a PostgreSQL, verificada con conteos, login y ownership.
- ⬜ Conectar Google Calendar al dashboard e importar eventos como tareas con
  fecha límite.
- ⬜ Reforzar la recuperación de cuenta con un canal verificado antes de pensar
  en uso público.
- ⬜ Cachear recomendaciones para no volver a llamar a z.ai si la tarea no
  cambió.

### Semana 5 — Colaboración, limpieza y mejoras visuales

- ⬜ Espacios de equipo: varios usuarios compartiendo un mismo conjunto de
  tareas.
- ⬜ Asignar tareas a miembros del equipo.
- ⬜ Avisar por Telegram cuando alguien modifica una tarea asignada.
- ⬜ Limpiar código muerto: los módulos de Supabase sin uso y los scripts de
  diagnóstico sueltos.
- ⬜ Mejoras visuales del dashboard.

### Semana 6 — Despliegue y producción

- ✅ Migrar a PostgreSQL para soportar concurrencia. **Cerrado:** es el motor
  único del proyecto.
- ✅ Preparar el despliegue: `compose.prod.yml` y el runbook de
  [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).
- ⬜ Publicar en Netcup con dominio y HTTPS propios.
- ⬜ Extender el pipeline con despliegue automático.
- ⬜ Versionar el prompt del sistema para poder rastrear cambios de calidad.

---

## 16. Documentación adicional

Si necesitas entrar en detalle, cada documento cubre una parte distinta:

**Para trabajar en el proyecto**

- [`docs/ENTORNO_WINDOWS.md`](docs/ENTORNO_WINDOWS.md) — Docker Desktop en
  Windows: dónde clonar, memoria de WSL2, puertos ocupados y los errores que
  parecen bugs pero no lo son.
- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — runbook del servidor: variables,
  proxy inverso, respaldos, actualización y vuelta atrás.
- [`docs/TODO_DESARROLLO.md`](docs/TODO_DESARROLLO.md) — el backlog por bloques,
  con lo hecho y lo pendiente.
- [`AGENTS.md`](AGENTS.md) — reglas de trabajo, verificación mínima y criterios
  de cierre.

**Para entender decisiones técnicas**

- [`docs/CIERRE_MIGRACION_POSTGRESQL.md`](docs/CIERRE_MIGRACION_POSTGRESQL.md) —
  cómo se retiró SQLite y qué implicó.
- [`docs/POSTGRESQL_DISENO_BLOQUE_2.md`](docs/POSTGRESQL_DISENO_BLOQUE_2.md) —
  diseño, diccionario de datos, comandos y límites del esquema.
- [`docs/MODO_COLABORATIVO.md`](docs/MODO_COLABORATIVO.md) — niveles de acceso,
  enlaces de invitación, endpoints y esquema del trabajo en equipo.
- [`api.md`](api.md) — contratos completos de la API inteligente.

**Registros y evidencia**

| Documento | Contenido |
|---|---|
| [`docs/pruebas-semana-3.md`](docs/pruebas-semana-3.md) | Mapa de pruebas: qué valida cada una, por qué aporta y con qué datos |
| [`docs/registro-pruebas-semana-3.md`](docs/registro-pruebas-semana-3.md) | Errores detectados, correcciones aplicadas y bloqueos abiertos |
| [`docs/QA_IA_LOCAL.md`](docs/QA_IA_LOCAL.md) | Prueba real de z.ai, hallazgos de calidad y correcciones de RAG |
| [`docs/QA_TELEGRAM_LOCAL.md`](docs/QA_TELEGRAM_LOCAL.md) | QA del bot con usuarios ficticios |
| [`docs/QA_ESTABILIZACION_LOCAL.md`](docs/QA_ESTABILIZACION_LOCAL.md) | Estabilización del entorno local |
| [`docs/Evidencia_Semana3.pdf`](docs/Evidencia_Semana3.pdf) | Evidencia de entrega de la semana 3 |
| `docs/CIERRE_BLOQUE_1..4.md` | Actas de cierre de cada bloque: resultados, QA y límites |

> Los `docs/CIERRE_BLOQUE_*.md` y las líneas base son **documentos históricos**.
> Describen cómo estaba el proyecto al cerrar cada bloque y contienen comandos
> que ya no existen. Cuando haya discrepancia, mandan el código, las migraciones
> y este README.

---

## 17. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework web | Astro 7.x (SSR con adaptador Node) |
| Base de datos | PostgreSQL 16 (único motor, también en pruebas) |
| ORM y migraciones | Drizzle ORM + drizzle-kit |
| IA generativa | z.ai — GLM (`glm-4.5-flash`) |
| IA local (respaldo) | Ollama + Llama 3.2 |
| Bot | Telegram Bot API |
| Autenticación | bcryptjs + JWT (jose) |
| Pruebas | Vitest 4 + @vitest/coverage-v8 |
| CI/CD | GitHub Actions |
| Runtime | Node.js 22.12 o posterior, dentro de la línea 22 |
| Contenedores | Docker Compose (web, migraciones, PostgreSQL, bot y planificador) |

---

Los documentos de entrega están en la carpeta [`docs/`](docs/).
