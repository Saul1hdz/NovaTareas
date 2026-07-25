# Cierre del Bloque 4: PostgreSQL y Docker local

> **Documento histórico.** Describe el estado del proyecto en el momento de
> cerrar este bloque. Los comandos de SQLite que aparecen abajo —`db:init`,
> `db:pg:import`, `DATABASE_ENGINE=sqlite`, `compose.postgres.yml`— **ya no
> existen**: PostgreSQL es el único motor. El procedimiento vigente de
> recuperación está en [`DESPLIEGUE.md`](DESPLIEGUE.md) y el detalle de la
> migración en [`CIERRE_MIGRACION_POSTGRESQL.md`](CIERRE_MIGRACION_POSTGRESQL.md).

Fecha: 24 de julio de 2026
Rama: `testing`
Alcance: desarrollo local; Netcup queda fuera.

## Resultado

La aplicación web, el bot y el scheduler comparten ahora una capa de acceso
asíncrona que puede usar PostgreSQL 16 o el SQLite conservado como rollback.
El entorno Docker levanta PostgreSQL, aplica migraciones antes de iniciar la
web y deja bot y scheduler como perfiles optativos para evitar procesos
duplicados.

## Inicio con Docker

1. Copiar `.env.example` a `.env` y completar únicamente los secretos de las
   integraciones que se probarán.
2. Ejecutar:

```bash
docker compose -f compose.dev.yml up -d --build web
```

La web queda en `http://127.0.0.1:4321` y PostgreSQL solo se publica en
`127.0.0.1:5434`.

El bot y el scheduler no arrancan por defecto:

```bash
docker compose -f compose.dev.yml --profile telegram up -d bot
docker compose -f compose.dev.yml --profile scheduler run --rm scheduler
```

El scheduler ejecuta una revisión y termina; más adelante un cron externo debe
invocarlo con la frecuencia elegida. Solo debe existir una instancia de polling
de Telegram. Para detener los servicios persistentes:

```bash
docker compose -f compose.dev.yml --profile telegram --profile scheduler down
```

Los volúmenes conservan PostgreSQL, dependencias y avatares. Eliminar volúmenes
con `down -v` borra esos datos y no forma parte del flujo normal.

## Migración verificada

Fuente: `tmp/block4-baseline/novatareas-pre-bloque4.db` (ignorada por Git).

- integridad SQLite: `ok`;
- 5 usuarios, 6 tareas y todas sus relaciones importadas;
- conteos idénticos en las nueve tablas trasladadas;
- cero filas huérfanas;
- cero tokens de Google en texto plano;
- importación confirmada dos veces desde PostgreSQL limpio;
- SQLite original sin modificaciones.

Comandos reproducibles:

```bash
npm run db:pg:migrate
SQLITE_MIGRATION_SOURCE=tmp/block4-baseline/novatareas-pre-bloque4.db npm run db:pg:import
SQLITE_MIGRATION_SOURCE=tmp/block4-baseline/novatareas-pre-bloque4.db SQLITE_MIGRATION_MODE=commit npm run db:pg:import
```

El modo predeterminado del importador es `dry-run` y siempre revierte. El modo
`commit` reemplaza únicamente las tablas de destino dentro de una transacción.

## QA funcional

El smoke test PostgreSQL crea y elimina datos ficticios automáticamente:

```bash
docker compose -f compose.dev.yml exec web npm run db:pg:smoke
```

Comprueba registro, hash y login, creación/listado de tareas, ownership entre
dos usuarios, actualización e historial transaccional y código Telegram de un
solo uso. También se verificó el login de una cuenta ficticia migrada.

En navegador se revisó el dashboard servido desde Docker/PostgreSQL en
escritorio y 390 × 844 px. La cuenta migrada, sus métricas y su tarea fueron
visibles; no aparecieron errores de consola.

## Rollback

PostgreSQL puede abandonarse sin transformar ni borrar SQLite:

1. detener Docker con `docker compose -f compose.dev.yml down`;
2. establecer `DATABASE_ENGINE=sqlite` en `.env`;
3. opcionalmente definir `NOVATAREAS_DB_PATH` a la copia SQLite elegida;
4. ejecutar `npm run dev`;
5. confirmar `npm test` antes de continuar trabajando.

No se copia una base sobre otra durante el rollback. Si se necesitara restaurar
una copia, primero se conserva el archivo actual y luego se configura
`NOVATAREAS_DB_PATH` hacia la copia, sin sobrescrituras.

## Límites que pasan al Bloque 5

- unificar proveedores, prompts y registro de recomendaciones de IA;
- separar recomendaciones de subtareas;
- modularizar el dashboard;
- limpiar código heredado de Supabase;
- persistir o declarar explícitamente el estado conversacional del bot.

Netcup, dominio, HTTPS, copias remotas y operación como servicio permanecen
fuera de este bloque.
