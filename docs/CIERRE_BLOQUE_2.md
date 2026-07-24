# Cierre del Bloque 2 — Esquema reproducible y PostgreSQL

Fecha: 2026-07-24

Rama: `testing`

Datos usados: exclusivamente ficticios

## Veredicto

El Bloque 2 queda cerrado para diseño y esquema. Existe una migración PostgreSQL
reproducible, una capa inicial de repositorios con ownership, cifrado de tokens
Google y pruebas reales del dialecto PostgreSQL. SQLite continúa siendo el
runtime de la aplicación hasta el Bloque 4.

No se realizó despliegue, no se usó Netcup y no se importaron datos.

## Implementación

- PostgreSQL 16 como versión objetivo.
- Drizzle ORM `0.45.2`, Drizzle Kit `0.31.10` y controlador `pg`.
- Diez tablas objetivo con claves foráneas, índices y restricciones.
- `DATE` para vencimientos sin hora.
- `TIMESTAMPTZ` para recordatorios, auditoría, expiraciones y códigos.
- Recomendaciones de IA separadas de las subtareas.
- Tokens de Google cifrados con AES-256-GCM y formato versionado.
- Repositorios iniciales para usuarios, tareas y comentarios.
- Eliminación del acceso SQLite duplicado del bot.
- PostgreSQL 16 local opcional mediante Compose, limitado a `127.0.0.1:5434`.

## Incidencias encontradas durante QA

1. El navegador solicitaba `/favicon.ico` y generaba un 404. Se añadió un icono
   SVG embebido en el layout común.
2. A 390 px el dashboard medía 513 px y cortaba tarjetas y botones. La causa era
   el tamaño mínimo implícito del elemento flex principal. Se añadió
   `min-width: 0` y se acotó su ancho móvil.
3. El acceso SQLite del bot duplicaba conexión, consultas y lógica de consumo de
   códigos. Se retiró y se reutilizaron los módulos compartidos.

## Evidencia automática

| Verificación | Resultado |
|---|---|
| `npm run db:pg:verify` | 10 tablas, 115 restricciones, reaplicación idempotente |
| `npm test` | 9 archivos, 65 pruebas aprobadas |
| `npm run test:coverage` | 65 aprobadas; 43.91% de líneas |
| `npm run lint` | 0 errores, 0 warnings; 20 hints heredados |
| `npm run build` | build SSR Node completado |
| `npm audit` | 0 vulnerabilidades conocidas |

La auditoría de dependencias requirió una resolución controlada de `esbuild`
porque Drizzle Kit arrastraba una versión antigua. El override quedó fijado en
el lockfile y todas las verificaciones posteriores aprobaron.

`npm ci` todavía informa paquetes transitivos obsoletos de Drizzle Kit,
`better-sqlite3` y otras dependencias. No producen avisos en `npm audit`, pero
deben revisarse al actualizar esas dependencias; no se forzó un salto mayor
fuera del alcance del bloque.

## Evidencia de navegador

Playwright, navegador real:

- registro de `qa-b2-1848@example.test`;
- sesión creada automáticamente tras el registro;
- tarea ficticia creada con prioridad alta, etiqueta y fecha;
- persistencia confirmada después de recargar;
- viewport de 390 × 844 sin desbordamiento horizontal;
- viewport de 1280 × 900;
- logout y login posterior correctos;
- tarea visible después del nuevo login;
- 0 errores de consola al finalizar.

El primer intento de logout móvil fue interceptado por la barra de desarrollo de
Astro, no por la aplicación. El mismo flujo se repitió correctamente en
escritorio. La barra no forma parte del build.

## Límite de la evidencia

El equipo actual no dispone de Docker, `psql` ni `pg_isready` en Windows. Por
eso la migración se verificó con PGlite, una compilación PostgreSQL embebida.
Esto valida SQL, esquema, restricciones y repositorios, pero no sustituye la
prueba posterior contra un servicio PostgreSQL 16 persistente.

Antes de cambiar el runtime en el Bloque 4 se debe ejecutar:

```bash
docker compose -f compose.postgres.yml up -d
docker exec novatareas-db-dev pg_isready -U novatareas -d novatareas
npm run db:pg:migrate
```

## Próxima fase

El Bloque 3 amplía pruebas deterministas y CI. En paralelo se puede preparar el
adaptador completo de datos, pero no debe activarse PostgreSQL como runtime hasta
que las rutas de escritura, transformaciones, conteos y rollback del Bloque 4
estén implementados y ensayados.
