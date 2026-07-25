# Cierre: migración a PostgreSQL nativo y preparación para despliegue

Documento de cierre del trabajo que llevó a NovaTareas de un proyecto con dos
motores de base de datos a uno que corre exclusivamente sobre PostgreSQL 16,
con la aplicación empaquetada y lista para publicarse en un VPS.

**Estado final verificado:** 103 pruebas en verde, 0 errores de lint, build
correcto, 0 vulnerabilidades en `npm audit`.

---

## 1. Por qué se hizo

El objetivo era que la aplicación corriera solo sobre PostgreSQL, se levantara
con Docker Compose y quedara lista para que un agente de despliegue la publicara
en Netcup.

Al inspeccionar el código antes de tocar nada aparecieron tres problemas que no
figuraban en ningún checklist y que cambiaban el punto de partida.

### 1.1 Las pruebas validaban un motor que no era el de producción

`vitest.config.js` fijaba `NOVATAREAS_DB_PATH` y nunca definía
`DATABASE_ENGINE`, así que `src/lib/db.js` instanciaba siempre better-sqlite3.
Las 88 pruebas ejercitaban el camino SQLite mientras Docker y el despliegue
usaban PostgreSQL.

La consecuencia más grave: `src/db/runtime.js` —la capa que traducía el SQL al
motor real— **tenía 0 % de cobertura porque no se cargaba en ninguna prueba**.
Toda la reescritura de consultas, la conversión de booleanos y el manejo de
fechas iban sin una sola verificación. El workflow de CI incluso migraba
PostgreSQL y a continuación ejecutaba la suite sobre SQLite.

### 1.2 La imagen de producción no funcionaba

`astro.config.mjs` no definía `server.host` ni `server.port`. El adaptador Node
en modo standalone cae por defecto a `localhost:8080`, así que el contenedor
escuchaba en una dirección inalcanzable desde fuera, pese al `EXPOSE 4321` del
Dockerfile. El target `runtime` nunca se había construido: `compose.dev.yml`
usaba `target: development` en todos los servicios y CI no construía la imagen.

### 1.3 Los recordatorios estaban muertos

`getUsersWithDueTasks` filtra por `reminder_at`, pero **ninguna ruta de la
aplicación escribía jamás esa columna**. El único sitio que la rellenaba era el
fixture de las pruebas. La funcionalidad pasaba los tests y no funcionaba.

### 1.4 La suite ni siquiera arrancaba en la máquina de trabajo

`better-sqlite3` estaba compilado para Node 22 (`NODE_MODULE_VERSION 127`) y el
Node instalado era v24 (`137`). `npm test` fallaba antes de ejecutar una sola
prueba. El punto de partida real estaba en rojo, no en verde.

---

## 2. Cómo se hizo: la estrategia

Reescribir el SQL y las pruebas a la vez habría dejado el trabajo sin red de
seguridad. La secuencia que lo evitó se apoyó en una observación sobre la capa
de compatibilidad: **era idempotente frente a SQL ya migrado**. Solo actuaba si
encontraba `?` o comparaciones booleanas al estilo SQLite, así que una consulta
escrita en PostgreSQL nativo la atravesaba intacta.

Eso permitió tres etapas en vez de un cambio de golpe:

1. **Mover las pruebas a PostgreSQL sin tocar una línea de SQL.** La suite pasó
   a validar por primera vez el motor real y se convirtió en la red de seguridad
   para lo que venía después.
2. **Reescribir el SQL archivo por archivo**, con la suite en verde entre lote y
   lote, y la capa de compatibilidad aún en su sitio para lo no migrado.
3. **Retirar la capa y SQLite** cuando ya no quedaba nada que traducir.

### El canario

Para saber cuándo la etapa 2 había terminado de verdad se instrumentó la capa de
compatibilidad con un contador de las consultas que aún transformaba. El avance
dejó de ser una impresión y pasó a ser un número:

| Momento | Consultas traducidas |
|---|---|
| Antes de reescribir | 62 |
| Tras `src/lib/db.js` | 59 |
| Tras autenticación y perfil | 49 |
| Tras tareas | 29 |
| Tras Telegram y Google | 19 |
| Tras RAG e IA | 18 |
| **Tras las pruebas y páginas** | **0** |

Al llegar a cero, la capa era un envoltorio inerte y se pudo borrar. El
instrumento se retiró con ella.

---

## 3. Errores encontrados y corregidos durante el trabajo

Estos no estaban previstos: aparecieron al ejecutar.

### 3.1 Las migraciones no creaban ninguna tabla

El nuevo setup de pruebas hacía `DROP SCHEMA public CASCADE` y volvía a migrar.
Pero el migrador de Drizzle guarda su registro en un esquema aparte llamado
`drizzle`, que sobrevivía al borrado. Al ver sus migraciones marcadas como
aplicadas, no creaba nada, y todas las pruebas fallaban con
`relation "users" does not exist`. Se corrigió borrando también ese esquema.

### 3.2 Un `DELETE` ajeno devolvía 200 en lugar de 404

Al pasar `result.changes` a `result.rowCount` en el borrado de tareas, la
comprobación quedó comparando `undefined === 0`, que es falso. El resultado: un
usuario que intentaba borrar la tarea de otro **recibía confirmación de éxito**.
Lo detectó la prueba de ownership. Se resolvió exponiendo `rowCount` en la capa.

Este fallo es la mejor justificación de la estrategia: sin haber movido primero
las pruebas a PostgreSQL, habría llegado al servidor sin que nada avisara.

### 3.3 El historial habría registrado cambios falsos

`archived` pasó de entero a booleano, pero el registro de historial comparaba
`String(oldTask.archived)` (`'false'`) contra `String(body.archived ? 1 : 0)`
(`'0'`). Nunca coincidirían, así que **cada guardado habría añadido una entrada
de historial inventada**. Se unificó a booleano en ambos lados.

### 3.4 Un `export ... from` dejó funciones sin definir

Al mover `dateInAppTimeZone` a un módulo compartido se reexportó con
`export { x } from './y.js'`, que no crea vínculo local. Las tres llamadas
internas del propio archivo habrían quedado indefinidas. Se corrigió importando
y reexportando por separado.

### 3.5 Un detector de dialecto con falso positivo

La prueba que impide que vuelva el SQL de SQLite marcaba `telegramBot.js`. La
causa: su expresión regular cruzaba la variable JavaScript `update` con el `?`
del encadenamiento opcional `update.callback_query?.`. Se acotó la búsqueda al
interior de literales de cadena.

### 3.6 El servidor nativo no leía `.env`

Astro y Vite exponen las variables de `.env` a `import.meta.env`, no a
`process.env`. Mientras faltar `DATABASE_URL` significaba "usa SQLite", el
problema era invisible; al volverse obligatoria, `npm run dev` fallaba con 500
en cada petición. Lo detectó el smoke test funcional, no la suite —que define
sus propias variables—. Se resolvió cargando `dotenv` en el cliente de base de
datos, donde no estorba en Docker ni en producción.

### 3.7 Restricciones que PostgreSQL sí aplica

Un fixture insertó una tarea completada sin `completed_at` y PostgreSQL lo
rechazó por el CHECK `tasks_completed_at_contract`. SQLite no validaba nada de
esto. Es una mejora real: el esquema ahora impide estados incoherentes.

---

## 4. Mejoras que surgieron en el camino

Cosas que no estaban en el plan y aparecieron al leer el código.

### 4.1 Dos ajustes de tipos que fallan en silencio

- **`COUNT(*)` llega como texto.** PostgreSQL devuelve BIGINT y el cliente lo
  entrega como cadena. `total - done` funcionaba por coerción, pero `total + done`
  habría concatenado. Se conserva el parser explícito y ahora hay una prueba que
  lo blinda.
- **`DATE` se convertía en objeto.** El cliente convertía `due_date` a una fecha
  a medianoche local, lo que desplaza el día al serializar. Toda la aplicación
  lo trata como `'YYYY-MM-DD'`. Se añadió el parser que lo mantiene como texto:
  no estaba antes y era un fallo latente.

### 4.2 Tres definiciones distintas de "hoy"

El dashboard calculaba el día en UTC, las notificaciones en `APP_TIME_ZONE` y el
bot con la zona del servidor. Durante seis horas al día una tarea podía aparecer
vencida en la web y no en Telegram. Ahora hay un único `src/lib/appTime.js`.

### 4.3 Identificadores de ruta no numéricos

`/api/tasks/abc` pasaba de devolver 404 a devolver 500, porque las claves son
`integer` y PostgreSQL rechaza el valor. Se añadió `src/lib/routeParams.js` para
normalizarlos y conservar el 404.

### 4.4 Una condición de carrera en el registro

`register.js` consulta si el correo existe y luego inserta. Con un índice único
real, dos registros simultáneos hacían que uno devolviera 500. Ahora el código
de error de duplicado se traduce a 409.

### 4.5 Orden no determinista en el listado

La agregación de subtareas no fijaba orden, así que dos peticiones idénticas
podían devolver listas distintas. Se añadió `ORDER BY s.id` dentro del agregado.

### 4.6 Un `UPDATE` que podía escribir en la columna equivocada

`profile.js` construía el `UPDATE` empujando **dos fragmentos con un solo
parámetro** (`password_hash = ?` junto a `session_version = session_version + 1`).
Con `?` posicionales funcionaba por casualidad; con parámetros numerados, un
contador manual habría desalineado todo el `UPDATE` **sin lanzar ningún error**.
Se adoptó el criterio de numerar por la posición real en el arreglo.

### 4.7 El dashboard pasó a ser testeable

Las seis consultas del front-matter de `dashboard.astro` —un archivo de 2.884
líneas sin una sola prueba— se extrajeron a `src/lib/dashboardStats.js`, que hoy
tiene sus propios tests.

---

## 5. Qué se corrigió de lo que ya se sabía

### 5.1 Estado en memoria que no sobrevive a un despliegue

Los tokens de recuperación de contraseña vivían en un `Map` del proceso:
cualquier reinicio rompía una recuperación en curso, y con dos instancias
fallaba la mitad de las veces. Ahora se guardan **hasheados** en PostgreSQL, son
de un solo uso y caducan solos.

Los límites de intentos hacían lo mismo: se reiniciaban en cada despliegue,
regalando cuota completa. Ahora se cuentan en la base, así que valen para todos
los procesos.

### 5.2 Sesiones del bot sin caducidad

El `Map` de conversaciones no expiraba nunca y guardaba la lista completa de
tareas del usuario indefinidamente. Además, el bot por polling y el webhook son
procesos distintos y no compartían nada. Ahora viven en `telegram_sessions` con
15 minutos de caducidad, y solo se guardan identificadores de tarea.

### 5.3 Recomendaciones de IA que destruían el trabajo del usuario

El endpoint hacía `DELETE FROM subtasks` seguido de un `INSERT` con el texto de
la IA: **cada consulta borraba las subtareas reales escritas por la persona**.
Ahora se guardan en `task_recommendations`, con el origen (`zai`, `ollama`,
`history` o `rules`), el modelo y la versión del prompt. La interfaz distingue
ambas cosas.

### 5.4 Cuatro copias del motor de IA

La cascada z.ai → Ollama → reglas estaba duplicada en cuatro archivos, con
tiempos de espera de 25 a 45 segundos y dos copias **sin el chequeo previo de
Ollama**: en un servidor sin Ollama, esas esperaban quince segundos contra un
puerto cerrado en cada petición. Hoy hay un solo `src/lib/ai/providers.js`.

### 5.5 Recordatorios operativos

`reminder_at` ya se escribe desde la web y desde el bot; por defecto, la mañana
de la fecha límite en la zona de la aplicación. Al reagendar una tarea se
reinician **ambos** avisos: antes solo se reiniciaba uno, así que una tarea
vencida y movida a futuro nunca volvía a avisar.

### 5.6 Código muerto

Se eliminaron los restos de Supabase (cuatro archivos de 0 bytes), las
herramientas con Gemini, cinco migraciones heredadas —incluida una destructiva—,
el importador de SQLite y los artefactos `novatareas.db`. El lint pasó de 89 a
78 archivos analizados.

---

## 6. Preparación del despliegue

- **`compose.prod.yml`**: construye el target `runtime`, ejecuta las migraciones
  en un contenedor previo, no publica el puerto de PostgreSQL y exige que los
  secretos vengan del entorno.
- **Dockerfile corregido**: `HOST`/`PORT` explícitos, `tini` como PID 1 para que
  `docker stop` cierre limpiamente, usuario `node` en vez de root y `HEALTHCHECK`.
  Se verificó levantando la imagen: responde y sirve la página de inicio.
- **`/api/v1/health/ready`**: consulta la base y devuelve 503 si no responde. Se
  comprobó con la base caída. El endpoint anterior devolvía 200 en ese caso, así
  que ningún orquestador habría detectado la caída.
- **Avatares**: se escribían en `public/`, pero en producción los estáticos se
  sirven desde `dist/client`. Cualquier avatar subido en el servidor habría dado
  404. Ahora la ruta depende del entorno y admite un volumen.
- **`scripts/seed-demo.mjs`**: tres cuentas ficticias con tareas. Idempotente.
- **`docs/DESPLIEGUE.md`**: runbook completo, con backup, rollback, cron de
  recordatorios y la advertencia sobre `X-Forwarded-For` en el proxy.
- **CI**: ahora ejecuta las pruebas sobre PostgreSQL, construye la imagen de
  producción y comprueba que arranca y responde.

---

## 6b. Hallazgos de la auditoría posterior

Tras dar el trabajo por terminado se revisó el repositorio entero. Apareció esto,
ya corregido:

- **La comprobación de PostgreSQL en CI estaba ciega.** Verificaba una lista de
  10 tablas escrita a mano y el esquema ya tenía 13, así que habría pasado en
  verde aunque faltara una migración. Ahora deriva las tablas esperadas del
  propio esquema y no puede volver a desfasarse; se comprobó que falla
  correctamente contra una base vacía.
- **La guarda anti-SQLite no cubría `telegram/`.** Un `?` reintroducido en el bot
  no habría fallado en pruebas y habría reventado en ejecución.
- **`TEST_DATABASE_URL` definido en `.env` se ignoraba.** Vitest evalúa su
  configuración antes de cargar `.env`, así que las pruebas siempre iban al
  puerto por defecto. A quien cambie `POSTGRES_PORT` —probable en Windows, donde
  el 5434 puede estar reservado— le habría dado un error engañoso pidiendo
  levantar un contenedor que ya estaba arriba.
- **No había `.gitattributes`.** El equipo trabaja en Windows con
  `core.autocrlf=true`, así que todo se clona con finales de línea CRLF. Hoy no
  rompe nada porque no hay scripts de shell, pero un `.env` creado con un editor
  de Windows mete un `\r` **dentro del valor** de las variables y las firmas de
  sesión fallan sin explicación. Al publicar hay que ejecutar una vez
  `git add --renormalize .`.
- **El healthcheck de desarrollo consultaba el endpoint que siempre devuelve
  200**, así que un contenedor con la base caída se reportaba sano. Producción ya
  usaba el correcto; desarrollo se había quedado atrás.
- **`DATABASE_ENGINE` seguía en `compose.dev.yml`**, sugiriendo un selector de
  motor que ya no existe.
- **El Dockerfile copiaba `drizzle.config.mjs`** a la imagen de producción, donde
  `drizzle-kit` no está instalado.

Además se corrigió documentación que describía un proyecto que ya no existe: el
README daba 88 pruebas en vez de 103, listaba archivos de prueba borrados,
documentaba `npm run db:init` (inexistente) y ofrecía un rollback a SQLite que es
imposible. Los `docs/CIERRE_BLOQUE_*.md` se marcaron como históricos, porque sus
procedimientos de recuperación fallarían al primer comando.

---

## 7. Lo que sigue pendiente

Con honestidad sobre los límites de este trabajo:

- **`dashboard.astro` sigue siendo monolítico** (2.884 líneas). Solo se extrajo
  el acceso a datos. La modularización del CSS y del JavaScript de cliente queda
  abierta.
- **Una sola réplica de web y una de bot.** El rate limiting y las sesiones ya
  están compartidos, pero el bot usa polling y no admite duplicados.
- **QA en navegador incompleta**: teclado, foco, contraste y matriz de anchos
  siguen sin cubrirse.
- **Sin logs estructurados ni métricas.**
- **Google Calendar** no se probó contra el servicio real; solo con dobles.
- La suite cubre bien los endpoints, pero `rag.js` sigue con poca cobertura.
- **Un fallo intermitente sin diagnosticar.** Durante la verificación final una
  ejecución de la suite falló una prueba; las seis ejecuciones siguientes
  pasaron completas y no se logró reproducir. No se identificó la causa, así que
  queda anotado: si vuelve a aparecer, conviene capturar el nombre de la prueba
  antes de descartarlo.
- **Tres archivos que el equipo debe decidir.** No se tocaron por no ser una
  decisión técnica: `pruebas-semana-3.md` existe duplicado en la raíz y en
  `docs/` con **contenidos distintos**; `README-seccion-pruebas.md` es un
  borrador cuyo contenido ya se integró en el README; y `output/` no está en
  `.gitignore`, así que hay PDF versionados —hay que decidir si son entregables
  o artefactos.
- **`coverage/` y `tmp/` conservan artefactos previos a la migración**, incluidas
  bases SQLite sueltas y HTML con el código antiguo. Están ignorados por Git,
  pero ensucian cualquier búsqueda futura en el proyecto.

---

## 8. Cómo verificar este estado

```bash
docker compose -f compose.dev.yml up -d db
docker compose -f compose.dev.yml exec db createdb -U novatareas novatareas_test
npm ci && npm test && npm run lint && npm run build
```

Resultado esperado: 103 pruebas en verde, 0 errores de lint y build correcto.

Verificación funcional de extremo a extremo, contra el servidor real:

```bash
npm run dev          # en otra terminal
npm run db:pg:smoke
```

Comprueba registro, hash y login, creación y listado de tareas, aislamiento por
ownership entre dos usuarios, actualización transaccional con historial y que el
código de vinculación de Telegram sea de un solo uso. **Ejecutado y aprobado.**

También se verificó a mano que `/dashboard` y `/profile` responden 200 y se
renderizan sin errores —ninguna de las dos páginas tiene pruebas automáticas— y
que una tarea creada con fecha límite guarda su `reminder_at` a las 09:00 de la
zona de la aplicación.

Para la imagen de producción, ver la sección 12 de `docs/DESPLIEGUE.md`.
