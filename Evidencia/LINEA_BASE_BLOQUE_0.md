# Línea base del Bloque 0

> Documento histórico. Conserva las versiones y resultados observados al cerrar
> el Bloque 0. Los comandos de SQLite que menciona —`db:init`, `migrate`— **ya no
> existen**: PostgreSQL es el único motor. El estado vigente está en
> [`CIERRE_MIGRACION_POSTGRESQL.md`](CIERRE_MIGRACION_POSTGRESQL.md).

Fecha: 2026-07-24

Rama: `testing`

## Entorno verificado

- Node recomendado: 22 LTS (`.nvmrc` fija la línea 22).
- Node usado para la verificación: 22.23.1.
- npm usado: 11.13.0.
- Astro: 4.16.19.
- React y React DOM: 18.3.1.
- `better-sqlite3`: 9.6.0.
- Vitest: 2.1.9.
- TypeScript: 5.9.3.

Node 24.16.0 no pudo instalar `better-sqlite3@9.6.0`: no existe binario
precompilado para esa combinación y la compilación nativa falla porque esta
versión fuerza C++17 mientras Node 24 requiere C++20. Por eso el proyecto declara
compatibilidad con Node 20 y 22, y recomienda Node 22.

## Verificaciones iniciales

| Verificación | Resultado |
| --- | --- |
| `npm test` | Línea base: 2 archivos y 25 pruebas aprobadas |
| `npm run lint` | Correcto: 0 errores; 31 observaciones |
| `npm run build` | Correcto: compilación SSR con `@astrojs/node` |
| `npm audit` | Pendiente de remediación: 5 moderadas, 4 altas y 2 críticas |
| Smoke test local | Portada, `/api/v1/health` y `/api/v1/metadata`: HTTP 200 |

Las observaciones de `astro check` son deuda del código, no un fallo del entorno:
incluyen parámetros sin tipo o sin uso, eventos globales obsoletos y scripts
inline. Se resolverán en los bloques correspondientes, sin mezclarlas con la
protección de datos del Bloque 0.

El reporte de dependencias afecta principalmente a Astro 4/Vite y a Vitest 2.
Las correcciones propuestas por npm requieren actualizaciones mayores (Astro 7,
adaptador Node 11 y Vitest 4). No se ejecutó `npm audit fix --force`: esos saltos
deben hacerse en una rama controlada, consultando las guías de migración y
repitiendo pruebas funcionales. Mientras tanto, el servidor de desarrollo debe
escuchar únicamente en `localhost`, nunca exponerse a Internet.

## Estado de la base de datos

No se encontró ningún archivo `novatareas.db`, `*.db`, `*.sqlite` o `*.sqlite3`
en esta copia del repositorio. Por tanto, no existe una base local que respaldar,
inventariar o migrar en este equipo. Si otro integrante conserva una base, debe
entregar una copia antes del Bloque 2 para evaluarla por separado.

## Protección aplicada en el Bloque 0

- `npm run migrate` dejó de encadenar los scripts heredados.
- Durante el Bloque 0 el comando quedó bloqueado para evitar daños.
- No se eliminó el archivo heredado para conservarlo como evidencia y facilitar
  la reconstrucción controlada del esquema.
- Ningún arranque habitual (`dev`, `build`, `start`) ejecuta migraciones.
- `.env.example` contiene placeholders para las variables mínimas conocidas y
  no contiene credenciales reales.

## Evolución posterior de esta línea base

Esta sección conserva el estado observado al cerrar el Bloque 0. Después se
añadió `migrations/sqlite/001_initial.sql` y un migrador transaccional e
idempotente. El comando `npm run db:init` ya permite preparar un clon limpio y
rechaza sin modificar una base heredada que no tenga registro de migraciones.

La verificación posterior aprobó 43 pruebas en 6 archivos, además de registro,
login, creación de tareas, ownership, recuperación y renderizado literal de
texto potencialmente peligroso en navegador. Esto habilita pruebas locales
cerradas con datos ficticios; no habilita exposición a Internet ni Netcup.
