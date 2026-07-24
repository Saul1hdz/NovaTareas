# QA local de Telegram

Fecha: 2026-07-24

## Alcance

Pruebas cerradas con una cuenta ficticia, la web y el bot ejecutándose en la
misma computadora y compartiendo la misma base SQLite. No se utilizó Netcup ni
información de usuarios reales.

## Recorrido verificado

- validación del token mediante `getMe`;
- vinculación mediante código temporal de ocho caracteres;
- rechazo de comandos desconocidos;
- ayuda con `/ayuda`;
- creación guiada de una tarea con `/nuevatarea`;
- rechazo de una fecha con formato inválido;
- selección de prioridad mediante botón;
- persistencia inmediata de la tarea en el dashboard;
- recomendación de z.ai desde `/recomendacion`;
- notificación de tarea completada desde la web hacia Telegram;
- reapertura de la tarea y actualización de estadísticas;
- ejecución manual del scheduler sin tareas elegibles.

## Resultado

El flujo web ↔ SQLite ↔ bot funciona localmente. La tarea ficticia creada desde
Telegram apareció en el dashboard con título, descripción, prioridad y fecha
correctos. La recomendación de z.ai respondió y las notificaciones por cambios
hechos desde la web llegaron al chat vinculado.

## Correcciones realizadas durante QA

- `bot:dev` y `bot:scheduler` ya no usan `--experimental-sqlite`, porque ambos
  procesos trabajan con `better-sqlite3`.
- El perfil muestra el nombre público correcto: `@NovaTareaBot`.
- El scheduler reutiliza la implementación probada de recordatorios y solo
  marca una entrega cuando Telegram la acepta.
- El contador `Total activas` excluye tareas completadas.
- El bot anuncia únicamente el formato de fecha que realmente acepta:
  `YYYY-MM-DD`.
- La notificación de una tarea completada usa `vence`, `vence hoy` o `vencía`
  según la relación entre la fecha límite y el día actual.

## Pendiente explícito

Las alertas de tareas vencidas funcionan, pero todavía no existe un control en
la web ni una pregunta en el bot que guarde `tasks.reminder_at`. Por eso los
recordatorios de anticipación no son configurables por el usuario. Antes de
implementarlos debe definirse:

- si el usuario elige fecha y hora o una anticipación;
- la hora predeterminada para tareas que solo tienen fecha;
- la conversión con `APP_TIME_ZONE`;
- cómo reiniciar `reminder_sent` al reprogramar una tarea.

Este pendiente no bloquea la creación, vinculación, IA ni notificaciones
inmediatas, pero sí bloquea declarar completos los recordatorios programados.

## Verificación técnica

- `npm test`: 13 archivos y 84 pruebas aprobadas.
- `astro check`: 0 errores; 20 sugerencias heredadas.
- `astro build`: compilación SSR aprobada.
- QA real en Telegram Desktop y dashboard local aprobada con datos ficticios.
