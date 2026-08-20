# Observabilidad, rendimiento y escalabilidad

Semana 5 · Módulo 4 — NovaTareas Pro

Este documento describe la instrumentación incorporada al proyecto, la línea
base de rendimiento medida sobre el flujo crítico, el cuello de botella
identificado con evidencia y el plan de escalabilidad que se deriva de él.

Todo lo que aparece aquí se midió sobre este repositorio. Las cifras se pueden
reproducir con los comandos que se indican en cada sección.

---

## 1. Servicio y flujo crítico

NovaTareas Pro es un gestor de tareas con asistente de productividad. Corre como
aplicación Astro en modo servidor (adaptador Node) contra PostgreSQL 16, y
expone además una API pública `/api/v1` con el motor de recomendaciones.

**Flujo crítico elegido: `GET /api/tasks`.**

Es la petición que more importa al usuario y la que más se ejecuta: el dashboard
la lanza al cargar, al filtrar, al buscar, al crear, completar, archivar o
borrar una tarea, y al cambiar de vista. Si esta ruta se degrada, la aplicación
entera se siente lenta aunque todo lo demás funcione.

La consulta no es trivial: agrega las subtareas con `STRING_AGG` y trae la
última recomendación de IA de cada tarea con un `LEFT JOIN LATERAL`, todo
filtrado por usuario y estado de archivado.

Como **control** se mide también `GET /api/v1/health`, que no consulta la base
ni valida sesión. Sin esa referencia, cualquier latencia se atribuiría por
defecto a la consulta, que es justo el error que este trabajo evita.

---

## 2. Preguntas de observabilidad

La instrumentación se diseñó a partir de las preguntas que hay que poder
responder cuando algo va mal, no al revés:

| # | Pregunta | Campo que la responde |
|---|----------|----------------------|
| 1 | ¿De qué solicitud concreta habla el usuario que reporta el fallo? | `request_id` |
| 2 | ¿Qué funcionalidad se ejecutó? | `route`, `method` |
| 3 | ¿Terminó bien, la rechazamos nosotros o se rompió el servidor? | `status`, `outcome` |
| 4 | ¿Cuánto tardó? | `duration_ms` |
| 5 | ¿Qué parte del tiempo fue base de datos y cuántas consultas costó? | `db_duration_ms`, `db_queries` |
| 6 | ¿Qué componente inteligente respondió y con qué modelo y prompt? | `ai_component`, `ai_source`, `ai_model`, `ai_prompt_version` |
| 7 | ¿Hubo que degradar a un respaldo porque el proveedor falló? | `ai_fallback`, `ai_duration_ms` |
| 8 | Cuando falló, ¿de qué tipo fue el fallo? | `error_type` |
| 9 | ¿Qué versión del código lo produjo? | `app_version` |
| 10 | ¿Los trabajos programados siguen ejecutándose? | `/api/v1/health/jobs` (§ 3.4) |

La pregunta 10 se añadió después, y por las malas: las nueve primeras se
responden mirando eventos, y un trabajo programado que muere **no produce
ningún evento**. Ver § 3.4.

---

## 3. Instrumentación

### 3.1 Dónde vive

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/lib/observability.js` | Contrato del evento, contexto por solicitud, redacción y escritura |
| `src/middleware.js` | Mide toda solicitud y emite un evento por cada una |
| `src/db/client.js` | Acumula número y duración de las consultas a PostgreSQL |
| `src/lib/aiEngine.js` | Anota qué proveedor, modelo y versión de prompt respondieron |
| `src/pages/api/tasks.js`, `src/pages/api/v1/recommend.js` | Anotan el tipo de cada error controlado |

### 3.2 Decisiones de diseño

**Un evento por solicitud, no varias líneas sueltas.** Correlacionar a mano
mensajes de `console.log` dispersos era exactamente el problema previo. Cada
solicitud produce una única línea JSON con todo lo necesario.

**El middleware instrumenta, las rutas anotan.** Ninguna ruta puede olvidarse de
registrar su evento porque no es ella quien lo emite. El `request_id` viaja por
`AsyncLocalStorage`, así que el código anidado —incluido el cliente de
PostgreSQL— puede añadir información sin recibir parámetros nuevos.

**Lista blanca de campos.** `EVENT_FIELDS` en `observability.js` es el único
sitio donde se decide qué se publica. Lo que no está ahí no sale, venga de
donde venga. Esto convierte la privacidad en una propiedad estructural en lugar
de una disciplina que hay que recordar en cada `console.log`.

**Las rutas se normalizan.** Se registra `/api/tasks/:id/comments`, nunca
`/api/tasks/42/comments`, y `/unirse/:token` nunca lleva el token real. Sirve
para agrupar métricas por endpoint y evita publicar identificadores y
credenciales en un log que acaba en un PDF.

### 3.3 Código de la instrumentación

Contrato del evento (`src/lib/observability.js`):

```js
const EVENT_FIELDS = [
  'ts', 'level', 'event', 'request_id', 'method', 'route', 'status',
  'outcome', 'duration_ms', 'app_version',
  'ai_component', 'ai_source', 'ai_model', 'ai_prompt_version',
  'ai_duration_ms', 'ai_fallback',
  'error_type', 'db_queries', 'db_duration_ms',
];

function buildEvent(fields) {
  const event = {};
  for (const key of EVENT_FIELDS) {
    if (fields[key] !== undefined && fields[key] !== null) event[key] = fields[key];
  }
  return event;
}
```

Medición de toda solicitud (`src/middleware.js`):

```js
export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const pathname = new URL(request.url).pathname;
  if (!shouldLogPath(pathname)) return next();

  const requestId = resolveRequestId(request.headers.get('x-request-id'));
  const startedAt = performance.now();

  return runWithRequestContext({ request_id: requestId }, async () => {
    let response, thrown = null;
    try { response = await next(); } catch (error) { thrown = error; }

    const status = thrown ? 500 : response.status;
    if (thrown) annotate({ error_type: errorTypeOf(thrown) });

    logRequestEvent({
      ...currentContext(),
      level: status >= 500 ? 'error' : 'info',
      request_id: requestId,
      method: request.method,
      route: normalizeRoute(pathname),
      status,
      outcome: outcomeFor(status),
      duration_ms: Math.round(performance.now() - startedAt),
    });

    if (thrown) throw thrown;
    response.headers.set('x-request-id', requestId);
    return response;
  });
});
```

Coste real de PostgreSQL (`src/db/client.js`), en el único punto por el que
pasan todas las consultas:

```js
async query(text, values = []) {
  const startedAt = performance.now();
  try {
    return await (this.client || this.pool).query(text, values);
  } finally {
    recordDbQuery(performance.now() - startedAt);
  }
}
```

Componente inteligente (`src/lib/aiEngine.js`):

```js
const report = (source, model, fallback) => annotate({
  ai_component: 'recommendation-engine',
  ai_source: source,               // zai | ollama | rules
  ai_model: model,
  ai_prompt_version: PROMPT_VERSION, // 'recommend-v1'
  ai_duration_ms: Math.round(performance.now() - startedAt),
  ai_fallback: fallback,
});
```

### 3.4 Lo que la instrumentación por eventos no ve: el silencio

Toda la instrumentación anterior se dispara **cuando algo pasa**. Su punto ciego
es el caso contrario, y costó meses descubrirlo: el cron que llama a
`/api/cron/reminders` nunca se instaló en el servidor, así que los recordatorios
de Telegram no se enviaron nunca. No hubo ni un solo evento de error, porque no
hubo ni una sola ejecución. `/api/v1/health/ready` respondió 200 todo ese
tiempo, la base sana y cero reinicios: esa sonda comprueba que el servicio
responde, no que haga su trabajo.

La ausencia de señal no es una señal. Para que lo sea hay que registrar la
presencia y dejar que envejezca:

| Pieza | Responsabilidad |
|---|---|
| Tabla `job_runs` | Una fila por trabajo con `last_run_at`, `last_ok` y `last_summary`. No es un historial: es la marca de vida, sobrescrita en cada barrido. |
| `src/lib/jobRuns.js` | Escribe la marca (`recordJobRun`) y decide qué está atrasado (`summarizeJobs`). Registrar nunca lanza: un fallo al escribir la marca la deja envejecer, que es el lado seguro. |
| `src/pages/api/cron/reminders.js` | Deja marca **en los dos caminos**, éxito y error. Si solo se registrara el éxito, un cron que falla siempre se vería igual que uno que no existe. |
| `/api/v1/health/jobs` | Publica el estado. **503** si algún trabajo lleva más de 45 minutos sin correr (tres ciclos del cron de 15) **o si su último intento falló**; 200 solo si todos están sanos. El campo `reason` distingue `stale` de `failing`. |

Tres decisiones que sostienen todo lo demás:

1. **Nunca ejecutado cuenta como atrasado**, no como correcto. Cero ejecuciones
   en toda la historia del despliegue era literalmente el caso a detectar; si
   diera verde, la sonda reproduciría el fallo que existe para encontrar.
2. **Un trabajo que corre y revienta cada ciclo tampoco está sano.** Nadie
   recibe sus avisos, igual que si el cron no existiera: es el mismo fallo con
   otra cara, así que también responde 503. Se distingue de `stale` porque se
   investiga en otro sitio —los logs de la aplicación, no el crontab—, no
   porque sea menos grave. El precio es que un fallo pasajero enciende la
   alerta durante un ciclo; se acepta a cambio de no ser ciego ante uno
   permanente, y no se suaviza con un contador de intentos consecutivos.
3. **La alerta la da un vigilante externo al servidor**, no la aplicación. Quien
   avisa no puede ser quien está caído. La aplicación expone el estado; el
   vigilante consulta con `curl -f` y avisa por Telegram.

La ruta **no** entra en el `HEALTHCHECK` del contenedor: un cron parado no debe
sacar la web del balanceador. El contrato completo está en `api.md` § 1c.

---

## 4. Evidencias

### 4.1 Evento exitoso

Petición y respuesta:

```
$ curl -s -o /dev/null -D - "http://127.0.0.1:4321/api/tasks?archived=0" -H "Cookie: $COOKIE"
HTTP/1.1 200 OK
x-request-id: a361aae4-3edf-4469-94d3-bcb645de4800
```

Evento correspondiente en el log:

```json
{"ts":"2026-08-14T02:52:35.328Z","level":"info","event":"http_request",
 "request_id":"a361aae4-3edf-4469-94d3-bcb645de4800","method":"GET",
 "route":"/api/tasks","status":200,"outcome":"success","duration_ms":24,
 "app_version":"dev","db_queries":2,"db_duration_ms":18.93}
```

**Interpretación.** El identificador que se devolvió al cliente en la cabecera
`x-request-id` es exactamente el mismo que aparece en el log: quien reporta un
problema puede citarlo y el evento se localiza sin buscar por hora aproximada.
La solicitud tardó 24 ms, de los cuales 18,93 ms fueron PostgreSQL repartidos en
2 consultas. Es la primera petición tras reiniciar el contenedor, así que
incluye el coste de abrir el pool; en régimen estable esa cifra baja a ~3 ms
(sección 5).

### 4.2 Error controlado

```
$ curl -s -D - "http://127.0.0.1:4321/api/tasks?priority=inventada" -H "Cookie: $COOKIE"
HTTP/1.1 400 Bad Request
x-request-id: 6e4ce0b3-4331-40b5-a4a8-e829b0835b8b
{"error":"Prioridad inválida"}
```

```json
{"ts":"2026-08-14T02:52:35.477Z","level":"info","event":"http_request",
 "request_id":"6e4ce0b3-4331-40b5-a4a8-e829b0835b8b","method":"GET",
 "route":"/api/tasks","status":400,"outcome":"client_error","duration_ms":4,
 "app_version":"dev","error_type":"prioridad_invalida","db_queries":1,
 "db_duration_ms":1.32}
```

**Interpretación.** El rechazo es deliberado, no una excepción: `outcome` lo
clasifica como `client_error` y `error_type` dice **por qué** se rechazó, de modo
que se pueden contar los 400 por causa en lugar de tener un montón
indistinguible. El valor inválido que envió el cliente **no** aparece en el log.

Un detalle que solo se ve gracias a la instrumentación: la petición rechazada
gasta igualmente **una** consulta a la base. Es la validación de sesión, que
ocurre antes que la del filtro (sección 6).

### 4.3 Datos excluidos por privacidad y seguridad

No aparecen en el log, por diseño y no por disciplina:

| Excluido | Por qué |
|----------|---------|
| Cuerpos de solicitud y respuesta | Llevan títulos, descripciones y comentarios del usuario |
| Cabeceras (`Authorization`, `Cookie`) | Contienen el token de sesión y la clave de la API |
| Contraseñas y respuestas de seguridad | Nunca salen de su hash |
| Cadena de conexión y SQL con parámetros | Revelaría credenciales y datos de usuario |
| Correo, nombre y teléfono | Datos personales innecesarios para diagnosticar |
| Query string | Un término de búsqueda es contenido del usuario |
| Tokens de invitación en la ruta | `normalizeRoute` los sustituye por `:token` |
| Mensaje de la excepción | Puede arrastrar valores; solo se publica la clase |

Esto está cubierto por pruebas automatizadas en `tests/observability.test.js`,
que verifican que campos como `authorization`, `password`, `email`, `cookie` o
`body` se descartan aunque alguien los pase explícitamente al logger.

---

## 5. Línea base de rendimiento

### 5.1 Escenario

| Parámetro | Valor |
|-----------|-------|
| Ambiente | Docker Desktop (WSL 2) sobre Windows 11 Pro; cliente en el host |
| Servicios | `web` (Node 22) + `db` (PostgreSQL 16), red interna de Compose |
| Endpoint | `GET /api/tasks?archived=0` con sesión iniciada |
| Datos | Cuenta ficticia `ana.demo@example.test`, 12 tareas en la base |
| Autenticación | Cookie de sesión obtenida vía `POST /api/login` |
| Solicitudes | 30 secuenciales por tanda; 40 en las tandas con concurrencia |
| Calentamiento | 3 solicitudes descartadas |
| Herramienta | `scripts/measure-endpoint.mjs` (de este repositorio) |
| Versión del código | rama `semana5-observabilidad`, `app_version=dev` / `build-semana5` |
| Componente IA | `recommend-v1`, modelo `glm-4.5-flash`; no interviene en este endpoint |

Reproducción:

```bash
MEASURE_USER_EMAIL=ana.demo@example.test MEASURE_USER_PASSWORD=... \
  node scripts/measure-endpoint.mjs --scenario=tasks --requests=30
```

### 5.2 Resultados — servidor de desarrollo (`astro dev`)

| Escenario | p50 (ms) | p95 (ms) | Máx (ms) | Error | req/s |
|-----------|---------:|---------:|---------:|------:|------:|
| `tasks` c=1 | 20,67 | 24,56 | 24,68 | 0 % | 47,9 |
| `tasks` c=4 | 45,45 | 142,69 | 159,15 | 0 % | 69,7 |
| `tasks` c=8 | 79,53 | 135,00 | 148,11 | 0 % | 90,7 |
| `tasks` c=16 | 218,09 | 298,35 | 379,87 | 0 % | 65,7 |
| `health` c=1 (control) | 14,02 | 20,87 | — | 0 % | 65,9 |
| `health` c=8 (control) | 52,13 | 79,25 | — | 0 % | 137,5 |

Mínimo 17,45 ms y promedio 20,82 ms en la tanda secuencial. Tasa de error 0 % en
todas las tandas: 30/30 y 40/40 respuestas `200`.

### 5.3 Resultados — servidor compilado (`node dist/server/entry.mjs`)

| Escenario | p50 (ms) | p95 (ms) | Máx (ms) | Error | req/s |
|-----------|---------:|---------:|---------:|------:|------:|
| `tasks` c=1 | 16,19 | 23,74 | 49,39 | 0 % | 56,4 |
| `tasks` c=4 | 31,36 | 87,60 | 109,83 | 0 % | 104,4 |
| `tasks` c=8 | 73,37 | 208,76 | 227,88 | 0 % | 93,0 |
| `tasks` c=16 | 172,05 | 291,81 | 546,09 | 0 % | 71,8 |

### 5.4 Cliente frente a servidor

La instrumentación permite comparar lo que mide el cliente con lo que el
servidor cree haber tardado. Tanda secuencial de 30 solicitudes, servidor
compilado, los mismos 30 eventos por ambos lados:

| Medida | p50 | p95 | Máx |
|--------|----:|----:|----:|
| Cliente (`measure-endpoint.mjs`) | 14,94 ms | 17,68 ms | 17,78 ms |
| Servidor (`duration_ms` del log) | 4 ms | 6 ms | 7 ms |
| PostgreSQL (`db_duration_ms`) | 2,97 ms | 4,20 ms | — |

Consultas por solicitud: **2**, constante.

---

## 6. Diagnóstico

### 6.1 Dónde se va el tiempo

Descomposición del p50 observado por el cliente (14,94 ms):

| Tramo | Tiempo | Porcentaje |
|-------|-------:|-----------:|
| Fuera de la aplicación (red de Docker Desktop en Windows + cliente) | ~10,9 ms | **73 %** |
| Aplicación sin base de datos | ~1,0 ms | 7 % |
| PostgreSQL (2 consultas) | ~3,0 ms | 20 % |

**El cuello de botella de la latencia percibida no está en el código.** Casi
tres cuartas partes se consumen antes de que la solicitud llegue al proceso
Node: reenvío de puertos de Docker Desktop entre Windows y la VM de WSL 2. Se
confirmó midiendo desde dentro del contenedor, donde el mismo endpoint de
control baja de ~17,8 ms a ~13,4 ms de p50.

El endpoint crítico añade solo ~6 ms sobre `health`, que no toca la base ni
valida sesión. **La consulta con `STRING_AGG` y `LEFT JOIN LATERAL` no es el
problema** con el volumen actual de datos, que era la hipótesis intuitiva.

### 6.2 Segundo hallazgo: la mitad de las consultas son de sesión

`db_queries` vale **2** en toda solicitud autenticada, y una de ellas no es de
negocio: `getUser()` valida la sesión con un `SELECT session_version FROM users`
en cada petición (`src/lib/auth.js`). Se paga incluso en peticiones que se van a
rechazar: el evento del 400 de la sección 4.2 muestra `db_queries: 1` sin haber
llegado a consultar tareas.

Es correcto por seguridad —permite invalidar sesiones al instante al cambiar la
contraseña— pero significa que el coste de base de datos por solicitud es el
doble del que exige la funcionalidad.

### 6.3 Comportamiento bajo carga

El *throughput* se estanca entre ~65 y ~105 req/s mientras la latencia crece de
forma aproximadamente proporcional a la concurrencia (c=1 → 16 ms; c=16 →
172 ms, unas 10,6 veces más con 16 veces más carga). Eso es saturación: más allá
de 4 peticiones simultáneas, el tiempo añadido es cola de espera, no trabajo.

El techo es prácticamente el mismo para `health` que para `tasks` y para el
servidor compilado que para el de desarrollo, lo que descarta la consulta y la
compilación como causa. **El límite es la capacidad de un único proceso Node en
un contenedor**, agravado por la red de Docker Desktop.

### 6.4 Riesgo detectado

Las mediciones desde el host tienen una varianza alta y no despreciable: dos
tandas idénticas del control `health` c=1 dieron 14,02 ms y 19,40 ms de p50. Es
propio de Docker Desktop en Windows. **Conclusión operativa: para decidir sobre
rendimiento hay que usar `duration_ms` del log, no el cronómetro del cliente.**
La instrumentación no es solo diagnóstico, es la métrica fiable.

---

## 7. Mejora aplicada y comparación

**Mejora aplicada: servir el proyecto compilado en lugar del servidor de
desarrollo.** El contenedor ejecutaba `npm run dev` (Vite con transformación de
módulos por solicitud), también cuando se enseñaba la demo.

| Métrica (`tasks` c=1) | `astro dev` | Compilado | Cambio |
|-----------------------|------------:|----------:|-------:|
| p50 | 20,67 ms | 16,19 ms | **−21,7 %** |
| p95 | 24,56 ms | 23,74 ms | −3,3 % |
| Throughput | 47,9 req/s | 56,4 req/s | +17,7 % |

La mejora se confirmó en dos ejecuciones independientes (−21 % y −22 %), así que
no es ruido de medición. En cambio **no mejora el techo bajo carga**, coherente
con el diagnóstico: la saturación es del proceso, no de la compilación.

Reproducción:

```bash
docker compose -f compose.dev.yml exec web npm run build
docker compose -f compose.dev.yml stop web
docker compose -f compose.dev.yml run -d --rm --service-ports \
  --name novatareas-build -e APP_VERSION=build-semana5 web node ./dist/server/entry.mjs
MEASURE_USER_EMAIL=... MEASURE_USER_PASSWORD=... \
  node scripts/measure-endpoint.mjs --scenario=tasks --requests=30
```

**Mejora propuesta, no aplicada: cachear la validación de sesión** unos segundos
en memoria para eliminar la mitad de las consultas por solicitud. No se aplica
porque tiene un coste de seguridad real —retrasaría la invalidación inmediata de
sesiones al cambiar la contraseña— y porque la evidencia dice que ahorraría
~1,5 ms sobre 15 ms: no compensa hoy. Se reconsiderará cuando la base deje de
estar en la misma máquina, donde cada consulta costará latencia de red.

---

## 8. Plan de escalabilidad

**Crecimiento considerado.** Demo cerrada de uso académico: decenas de usuarios
ficticios con picos durante una presentación. El escenario realista es 20–50
personas abriendo el dashboard a la vez, no tráfico sostenido.

**Restricción observada.** Un proceso Node satura entre 65 y 105 req/s y la
latencia crece linealmente a partir de 4 peticiones concurrentes. Con 50
usuarios simultáneos el p50 estimado supera los 400 ms.

**Orden de las mejoras, de mayor a menor rendimiento por esfuerzo:**

1. **Servir siempre el build.** Ya aplicado y medido: −21 % de p50 sin coste ni
   infraestructura adicional.
2. **No exponer Docker Desktop de Windows como entorno de servicio.** El 73 % de
   la latencia observada es de ese reenvío de puertos y desaparece en el
   despliegue Linux de `compose.prod.yml`. Es el cambio más rentable y no toca
   una línea de código.
3. **Escalar horizontalmente el contenedor `web`** detrás de un proxy. El estado
   compartido ya vive en PostgreSQL —sesiones de Telegram, límites de uso y
   tokens de recuperación se migraron a la base—, así que la aplicación es apta
   para varias instancias sin trabajo previo. Es la palanca correcta porque el
   límite medido es de proceso, no de consulta.
4. **Cachear la recomendación de IA**, no la lista de tareas. Un `GET /api/tasks`
   cuesta 3 ms de base; una llamada a z.ai cuesta segundos y dinero. Cachear por
   hash de la tarea es donde una caché rinde de verdad.

**Cuándo usar cada recurso.**

| Recurso | Cuándo | Indicador |
|---------|--------|-----------|
| Más instancias de `web` | Antes que nada, si sube la concurrencia | `duration_ms` p95 > 300 ms con CPU alta |
| Caché de recomendaciones | Al repetirse peticiones de IA equivalentes | `ai_duration_ms` domina `duration_ms` |
| Cola o *workers* | Solo si la IA pasa a ser síncrona y masiva | `ai_duration_ms` p95 > 5 s sostenido |
| Réplica de lectura | Cuando la base deje de ser el 20 % del tiempo | `db_duration_ms` > 50 % de `duration_ms` |

**Impacto en memoria, datos, privacidad y costo.**

- *Memoria*: cada instancia de `web` añade su propio proceso Node y su pool de
  conexiones. Con `PG_POOL_MAX=10`, cuatro instancias son 40 conexiones: hay que
  subir `max_connections` en PostgreSQL o bajar el pool por instancia.
- *Datos*: no cambia el modelo. No hay estado en memoria que replicar.
- *Privacidad*: una caché de recomendaciones guardaría texto derivado de tareas
  del usuario. Debería vivir en la base con el mismo control de propiedad que
  `task_recommendations`, nunca en un servicio externo.
- *Costo*: escalar horizontalmente en el mismo servidor es coste cero hasta
  agotar CPU. El gasto real del proyecto es z.ai por llamada, y ahí la caché
  ahorra dinero además de tiempo.

**Indicador para decidir cuándo escalar.** `duration_ms` p95 de `/api/tasks`
por encima de **300 ms** durante 5 minutos, medido en el log del servidor y no
en el cliente. Es accionable porque distingue la causa: si `db_duration_ms`
acompaña, el problema es la base; si no, es el proceso, y toca añadir instancias.

---

## 9. Limitaciones pendientes

1. **La línea base no cubre el camino con z.ai.** Medir 30 recomendaciones
   reales consume saldo del proveedor, y `AGENTS.md` exige autorización expresa
   para llamadas reales. La instrumentación de IA (`ai_source`, `ai_model`,
   `ai_prompt_version`, `ai_fallback`) está implementada y probada, pero la línea
   base numérica del componente inteligente queda pendiente de esa autorización.
2. **`POST /api/v1/recommend` no se midió** porque requiere `AI_API_KEY`, que no
   está definida en el entorno local; sin ella el endpoint responde 503. El
   escenario ya está implementado en el script y basta definir la variable para
   ejecutarlo.
3. **El ambiente medido es de desarrollo en Windows.** Las cifras absolutas no
   representan al despliegue Linux; sirven para comparar entre sí, que es para lo
   que se usan aquí.
4. **Varianza alta entre tandas** desde el host (sección 6.4). Las conclusiones
   de este documento se apoyan en diferencias reproducidas en dos ejecuciones o
   en métricas de servidor, no en una tanda aislada.
5. **El middleware no se ejercita en las pruebas automatizadas**, que invocan los
   handlers directamente. Se prueban en su lugar las funciones de
   `observability.js`, incluida la garantía de redacción.

---

## 10. Cómo reproducir todo

```bash
# 1. Entorno (sin el bot: su instancia de producción usa el mismo token)
docker compose -f compose.dev.yml up -d db web

# 2. Pruebas, incluidas las de observabilidad y estadística
npm test

# 3. Línea base del flujo crítico
MEASURE_USER_EMAIL=ana.demo@example.test MEASURE_USER_PASSWORD=... \
  node scripts/measure-endpoint.mjs --scenario=tasks --requests=30

# 4. Comportamiento bajo carga
MEASURE_USER_EMAIL=... MEASURE_USER_PASSWORD=... \
  node scripts/measure-endpoint.mjs --scenario=tasks --requests=40 --concurrency=8

# 5. Control sin base de datos ni sesión
node scripts/measure-endpoint.mjs --scenario=health --requests=40

# 6. Ver los eventos
docker compose -f compose.dev.yml logs web | grep http_request
```

Los resultados en bruto de cada ejecución quedan en `docs/mediciones/`.
