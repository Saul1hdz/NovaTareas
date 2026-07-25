# Línea base del Bloque 4 — SQLite a PostgreSQL

> **Documento histórico.** Describe el estado del proyecto en el momento de
> cerrar este bloque. Los comandos de SQLite que aparecen abajo —`db:init`,
> `db:pg:import`, `DATABASE_ENGINE=sqlite`, `compose.postgres.yml`— **ya no
> existen**: PostgreSQL es el único motor. El procedimiento vigente de
> recuperación está en [`DESPLIEGUE.md`](DESPLIEGUE.md) y el detalle de la
> migración en [`CIERRE_MIGRACION_POSTGRESQL.md`](CIERRE_MIGRACION_POSTGRESQL.md).

Fecha: 24 de julio de 2026

Rama: `testing`

Commit de partida: `0402b69428c5c53c3d3e83f3f5d8ee0099645fed`

## Estado de partida

- La aplicación continúa usando SQLite como runtime.
- PostgreSQL 16 se ejecuta localmente en un contenedor aislado llamado
  `novatareas-postgres-dev`.
- PostgreSQL solo escucha en `127.0.0.1:5434`.
- Las migraciones PostgreSQL crean las diez tablas esperadas.
- La comprobación del servicio insertó datos ficticios dentro de una
  transacción y confirmó su rollback.

## Respaldo SQLite

Se creó una copia consistente mediante la API de backup de SQLite:

`tmp/block4-baseline/novatareas-pre-bloque4.db`

La carpeta `tmp/` está ignorada por Git. El respaldo contiene datos locales y
no debe enviarse al repositorio.

- Tamaño: 131072 bytes.
- Integridad SQLite: `ok`.
- SHA-256:
  `F72862B86E64E00787239168B2EBC350F5E5085E683A5AE19E9E190CEEB4F903`

## Conteos de referencia

| Tabla | Filas |
|---|---:|
| `categories` | 0 |
| `schema_migrations` | 2 |
| `security_questions` | 5 |
| `subtasks` | 1 |
| `task_comments` | 2 |
| `task_embeddings` | 0 |
| `task_history` | 16 |
| `tasks` | 6 |
| `telegram_link_codes` | 1 |
| `users` | 5 |

Estos conteos pertenecen exclusivamente al respaldo. La base activa puede
cambiar durante pruebas posteriores, por lo que toda comparación de la primera
migración debe usar esta copia y no el archivo SQLite en ejecución.

## Regla de rollback

SQLite no se elimina ni se modifica durante los ensayos de importación. El
runtime no cambia a PostgreSQL hasta que:

1. los conteos y relaciones sean equivalentes;
2. no existan filas huérfanas;
3. login y tareas funcionen sobre PostgreSQL;
4. el proceso pueda repetirse desde una base PostgreSQL limpia;
5. el regreso a SQLite esté documentado y verificado.

## Primeros ensayos de importación

El importador transaccional se ejecutó contra PostgreSQL 16 usando únicamente
la copia anterior:

1. ensayo `dry-run`, con rollback automático;
2. importación confirmada;
3. limpieza exclusiva de las tablas locales PostgreSQL;
4. segunda importación confirmada desde la misma copia.

En ambos ensayos desde PostgreSQL vacío:

- los conteos coincidieron para las nueve tablas importadas;
- los identificadores originales se conservaron;
- no aparecieron tareas, subtareas, historial ni comentarios huérfanos;
- no faltaron hashes de contraseña;
- no se encontraron tokens de Google en texto plano;
- SQLite permaneció intacto.

`task_recommendations` no existe en el esquema SQLite actual y comienza vacía
en PostgreSQL. `schema_migrations` es metadato propio del migrador SQLite y no
se copia al esquema funcional PostgreSQL.

## Cierre

Las cinco condiciones de la regla de rollback se cumplieron. PostgreSQL quedó
habilitado como runtime mediante `DATABASE_ENGINE=postgres`, Docker quedó
documentado y SQLite se conservó como alternativa local. La evidencia final,
comandos de operación, QA y rollback están en
[`CIERRE_BLOQUE_4.md`](CIERRE_BLOQUE_4.md).
