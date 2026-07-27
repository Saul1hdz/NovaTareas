# AGENTS.md

Instrucciones operativas para cualquier agente de IA que trabaje en NovaTareas,
sea cual sea la herramienta.

## Objetivo y estado actual

NovaTareas es un proyecto universitario todavía en desarrollo. La meta es una
demo cerrada con usuarios ficticios; no es un servicio público ni está en
producción.

- Rama de trabajo actual: `testing`.
- Bloques 0 a 5 cerrados; parte del Bloque 6 (recordatorios, IA) también.
- **PostgreSQL 16 es el único motor.** SQLite se retiró por completo: no quedan
  driver, migraciones, importador ni capa de compatibilidad.
- Las pruebas corren contra PostgreSQL real, así que `npm test` **requiere el
  contenedor de base de datos levantado**.
- Docker es el entorno local recomendado. Para Windows con Docker Desktop, ver
  `docs/ENTORNO_WINDOWS.md` (OneDrive, memoria de WSL2, puertos y volúmenes).
- El despliegue está preparado (`compose.prod.yml` + `docs/DESPLIEGUE.md`) pero
  publicar en Netcup sigue requiriendo autorización explícita.

Antes de cambiar este estado, consulta:

- `README.md`
- `docs/TODO_DESARROLLO.md`
- `docs/CIERRE_MIGRACION_POSTGRESQL.md`
- `docs/DESPLIEGUE.md`

Los `docs/CIERRE_BLOQUE_*.md` son históricos: describen el estado al cerrar cada
bloque y contienen comandos que ya no existen.

El código, los manifiestos, las migraciones y el estado real de Git prevalecen
sobre documentos históricos.

## Reglas de trabajo

1. Inspecciona el repositorio y `git status` antes de modificar archivos.
2. Conserva cambios ajenos o sin confirmar. No limpies el árbol con comandos
   destructivos.
3. Si se pide diagnóstico o explicación, no cambies archivos.
4. Si se pide implementar o corregir, completa el cambio y verifícalo en
   proporción al riesgo.
5. No hagas commit, push, merge, release ni despliegue sin autorización
   explícita.
6. No despliegues a Netcup ni abras el servicio al público salvo que la petición
   lo autorice expresamente y el checklist de staging esté listo.
7. No inventes resultados de QA. Distingue pruebas automatizadas, navegador,
   servicios externos simulados y comprobaciones manuales.
8. Actualiza la documentación y el checklist cuando cierres un bloque o cambies
   comandos operativos.

## Git e identidad

Este repositorio pertenece al equipo de Moisés. No debe aparecer la identidad
personal de Isaac en commits o acciones remotas.

- Autor esperado: `moises <moisesantoniom@gmail.com>`.
- Remoto esperado: `git@github-work:Saul1hdz/NovaTareas.git`.
- Cuenta SSH esperada: `Moises1Martinez`.
- Rama habitual de desarrollo y QA: `testing`.

Antes de publicar:

```powershell
git branch --show-current
git config user.name
git config user.email
git remote get-url origin
git status --short
git diff --check
```

El repositorio fija finales de línea LF mediante `.gitattributes`, porque el
código se ejecuta dentro de contenedores Linux. La **primera vez** que se
publique tras añadirlo, hay que normalizar lo ya versionado:

```powershell
git add --renormalize .
```

`gh` puede estar autenticado con otra cuenta. No uses `gh pr create` ni otras
acciones de GitHub CLI sin confirmar primero que la cuenta activa sea la de
Moisés. `git pull` y `git push` usan el remoto SSH configurado y no dependen de
la sesión de `gh`.

## Entorno recomendado: Docker Desktop en Windows

El equipo puede ejecutar los comandos desde PowerShell. No necesita abrir una
terminal WSL, aunque Docker Desktop utilice WSL 2 o Hyper-V internamente.
Docker debe estar configurado para contenedores Linux.

Preparación:

```powershell
Copy-Item .env.example .env
# Completar únicamente las integraciones que se probarán.
```

Web, migraciones y PostgreSQL:

```powershell
docker compose -f compose.dev.yml up -d --build web
docker compose -f compose.dev.yml ps
```

La aplicación queda disponible en `http://127.0.0.1:4321` y PostgreSQL en
`127.0.0.1:5434`.

Comprobación funcional de PostgreSQL:

```powershell
docker compose -f compose.dev.yml exec web npm run db:pg:smoke
```

Bot de Telegram por polling:

```powershell
docker compose -f compose.dev.yml --profile telegram up -d bot
```

El bot solo puede tener una instancia de polling activa por token. Confirma que
ningún compañero lo esté ejecutando antes de iniciarlo.

El scheduler es de una sola ejecución:

```powershell
docker compose -f compose.dev.yml --profile scheduler run --rm scheduler
```

Detención normal, conservando datos:

```powershell
docker compose -f compose.dev.yml --profile telegram --profile scheduler down
```

No uses `down -v` salvo que el usuario autorice explícitamente eliminar los
volúmenes locales de PostgreSQL, dependencias y avatares.

## Ejecución nativa

La versión admitida es Node.js `>=22.12.0 <23.0.0`; `.nvmrc` fija `22.12.0` y el
Dockerfile usa `22.23.1`. Ya no hay módulos nativos, así que otra versión de Node
no impide instalar las dependencias, pero conviene mantener la del contenedor
para que las diferencias aparezcan en local y no al desplegar.

```powershell
nvm use 22
npm ci
Copy-Item .env.example .env
npm run dev
```

Procesos separados:

```powershell
npm run bot:dev
npm run bot:scheduler
```

Prefiere Docker cuando el equipo tenga versiones distintas de Node. En
ejecución nativa, `npm run dev` lee `.env` a través de `dotenv`, así que
`DATABASE_URL` debe apuntar al PostgreSQL publicado por Docker.

## Variables de entorno y secretos

- Nunca leas secretos en voz alta, los pegues en respuestas, logs o capturas,
  ni los incluyas en commits.
- `.env`, `.env.local` y las bases locales están ignorados por Git.
- `.env.example` solo puede contener placeholders y valores ficticios.
- No solicites que el usuario pegue API keys en el chat; indícale que las
  escriba localmente en `.env`.
- `SECRET_KEY` es obligatoria para sesiones.
- `ZAI_API_KEY` y `ZAI_MODEL` habilitan la IA externa.
- `TELEGRAM_BOT_TOKEN` solo se necesita al probar Telegram.
- No actives Ollama, Google Calendar, webhooks o cron si la prueba no los
  necesita. Si no hay un Ollama escuchando, deja `OLLAMA_URL` sin definir: el
  valor por defecto apunta a `localhost` y cada petición de IA pagaría una
  espera inútil antes de caer al respaldo.

Antes de publicar cambios, revisa que no se hayan agregado `.env`, tokens,
contraseñas, bases de datos, logs ni archivos temporales.

## Base de datos y migraciones

- PostgreSQL 16 es el único motor. No hay rollback a SQLite.
- Toda operación de datos debe respetar autenticación, ownership, transacciones
  y validación de entrada.
- El acceso es asíncrono: usa `await` con los helpers de `src/lib/db.js`. El
  envoltorio de `src/db/client.js` **no transforma el SQL**; lo que escribas es
  lo que se ejecuta.
- **Escribe SQL de PostgreSQL nativo**: placeholders `$1..$n`, booleanos
  `TRUE`/`FALSE`, `RETURNING id` en vez de `lastInsertRowid` y `rowCount` en vez
  de `changes`. `tests/noSqliteDialect.test.js` falla si aparece dialecto SQLite.
- En consultas construidas por partes, numera cada parámetro por su posición
  real (`params.push(v)` y luego `$${params.length}`). Un contador aparte se
  desalinea en silencio y escribe en la columna equivocada.
- Dentro de `withTransaction`, usa **siempre** el `tx` que recibe el callback.
  Una consulta sobre `db` correría fuera de la transacción y no vería los
  cambios sin confirmar.
- No edites migraciones ya aplicadas. Genera una nueva con
  `npm run db:pg:generate` tras modificar `src/db/postgres/schema.js`.

Migraciones PostgreSQL:

```powershell
npm run db:pg:generate   # tras editar src/db/postgres/schema.js
npm run db:pg:migrate
npm run db:pg:verify
```

Datos ficticios reproducibles para demostraciones:

```powershell
npm run db:seed
```

No vacíes PostgreSQL sin autorización explícita y un plan de rollback.

## Verificación mínima

Para cambios de código:

```powershell
docker compose -f compose.dev.yml up -d db
npm test
npm run lint
npm run build
npm audit
```

`npm test` necesita PostgreSQL levantado: recrea el esquema en la base indicada
por `TEST_DATABASE_URL`, cuyo nombre **debe terminar en `_test`**. El setup se
niega a tocar cualquier otra base, porque borra su esquema completo.

Crea la base de pruebas una sola vez:

```powershell
docker compose -f compose.dev.yml exec db createdb -U novatareas novatareas_test
```

Ya no hay módulos nativos, así que la versión de Node del host no rompe la
instalación como ocurría con `better-sqlite3`.

Además:

- Cambios en esquema o acceso a datos: migraciones, verificación PostgreSQL y
  smoke test.
- Cambios en autenticación, ownership o rutas mutables: pruebas negativas con
  otro usuario y entradas inválidas.
- Cambios visuales o de interacción: QA real en navegador, escritorio y móvil,
  revisando consola.
- Cambios de Telegram: usa usuarios ficticios, confirma una sola instancia de
  polling y detén el bot al terminar.
- Cambios de Docker: valida `docker compose -f compose.dev.yml config -q`,
  healthchecks, reinicio y detención sin eliminar volúmenes.

Los proveedores externos deben simularse en pruebas automatizadas. Una prueba
real con z.ai, Telegram o Google solo se realiza cuando el usuario la autoriza y
las credenciales están configuradas localmente.

## Criterio de cierre

Un bloque no se considera terminado únicamente porque compile. Debe incluir:

1. Implementación completa dentro del alcance aprobado.
2. Pruebas y build aprobados.
3. QA manual cuando aplique.
4. Riesgos y trabajo pendiente documentados.
5. Rollback o recuperación definidos.
6. Servicios locales detenidos al terminar.
7. Commit y push solamente si fueron autorizados.

