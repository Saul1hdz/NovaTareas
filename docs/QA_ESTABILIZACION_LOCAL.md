# QA de estabilización local

> Registro histórico anterior al cierre de seguridad. Los resultados vigentes
> están en [`CIERRE_BLOQUE_1.md`](CIERRE_BLOQUE_1.md).

Fecha: 24 de julio de 2026

Entorno: servidor Astro local en `localhost`, rama `testing`, usuarios y datos
ficticios.

## Veredicto

Los bloqueos funcionales encontrados durante la primera revisión quedaron
corregidos y verificados. El proyecto puede continuar con pruebas locales
cerradas. Este resultado no autoriza todavía un despliegue en Netcup ni equivale
a una aprobación para producción.

## Regresión verificada en navegador

- El registro crea la cuenta e inicia una sesión inmediatamente.
- Después de cerrar sesión, volver atrás no recupera el dashboard autenticado.
- Una tarea archivada puede reabrirse y vuelve a la lista activa.
- Crear una tarea después de seleccionar una etiqueta limpia el filtro y muestra
  la nueva tarea.
- La vista Agenda cambia su contenido al navegar entre meses.
- La recuperación presenta una respuesta indistinguible para correos inexistentes
  y permite regresar al login.
- El perfil genera un comando `/vincular CODIGO` válido durante 10 minutos, sin
  solicitar ni transmitir la contraseña.
- Los textos con HTML de prueba se muestran como texto y no se ejecutan.

## Verificación automatizada

- Vitest: 43 pruebas aprobadas en 6 archivos.
- Astro check: 0 errores; quedan 28 sugerencias no bloqueantes.
- Build SSR con `@astrojs/node`: aprobado.
- Migraciones SQLite: creación y reejecución idempotente verificadas.

## Riesgos que siguen abiertos

- Las dependencias actuales aún requieren una actualización controlada por los
  avisos de seguridad ya inventariados.
- Falta completar cobertura de subtareas, recordatorios, cron, conversación del
  bot y Google Calendar.
- Persisten handlers inline y bloques grandes de `innerHTML` que conviene retirar
  gradualmente, aunque los datos de tareas probados ya se escapan.
- La recuperación por preguntas de seguridad es aceptable para esta demo cerrada,
  pero no es el mecanismo recomendado para un servicio público.
- PostgreSQL aún no está implementado; la migración debe comenzar después de
  acordar el modelo y la capa de acceso a datos.

## Siguiente puerta

Antes de avanzar a PostgreSQL se recomienda cerrar primero las dependencias
vulnerables y los tests negativos de cron, webhook, ownership e inputs que siguen
pendientes en `TODO_DESARROLLO.md`.
