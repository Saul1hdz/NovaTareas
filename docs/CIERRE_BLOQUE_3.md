# Cierre local del Bloque 3 — suite de pruebas y CI

Fecha: 24 de julio de 2026

Rama: `testing`

## Estado

El Bloque 3 está completo en local y en CI. GitHub Actions confirmó el workflow
en verde sobre la rama `testing`:
[ejecución 30121273529](https://github.com/Saul1hdz/NovaTareas/actions/runs/30121273529).

No se realizó despliegue ni se modificó Netcup.

## Cambios implementados

- La suite creció de 65 a 80 pruebas.
- Se cubrieron logout, cambio de contraseña, ciclo completo de tareas,
  subtareas, historial y comentarios.
- Se simularon z.ai, Ollama, Telegram y Google sin usar claves reales ni saldo.
- Se probaron recordatorios, zona `America/El_Salvador` e idempotencia.
- Se configuró PostgreSQL 16 efímero en GitHub Actions.
- El workflow aplica migraciones, comprueba diez tablas y valida una transacción
  ficticia con rollback.
- La cobertura se conserva como artefacto durante 14 días.

La estrategia de mocks sigue la guía oficial de
[Vitest](https://v4.vitest.dev/guide/mocking/modules). El servicio PostgreSQL y
los artefactos siguen los patrones documentados por
[GitHub Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
y [workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).

## Corrección funcional descubierta durante QA

Los avisos se marcaban como enviados aunque Telegram no estuviera configurado,
respondiera con error o fallara la red. Eso impedía reintentar posteriormente.

Ahora `reminder_sent` y `overdue_notified` solo cambian después de una entrega
aceptada por Telegram. El cálculo de tareas vencidas también utiliza
`APP_TIME_ZONE`, cuyo valor predeterminado es `America/El_Salvador`, en vez de
depender del corte UTC.

## Evidencia local

| Verificación | Resultado |
|---|---|
| `npm test` | 12 archivos, 80 pruebas aprobadas |
| `npm run test:coverage` | 80 aprobadas; 57.17% de líneas |
| `npm run lint` | 0 errores y 0 advertencias; 20 sugerencias heredadas |
| `npm run build` | Compilación SSR aprobada |
| `npm run db:pg:verify` | 10 tablas, 115 restricciones, reejecución aprobada |
| `npm audit` | 0 vulnerabilidades |
| Smoke en navegador | Login y dashboard correctos; 0 errores de consola |
| GitHub Actions | PostgreSQL, migraciones, 80 pruebas, cobertura y build aprobados |

La prueba deliberada de fallo de Telegram registra un `503` simulado en stderr.
Ese mensaje es evidencia del caso negativo y no un fallo de la suite.

## Hallazgo del primer clon limpio

La primera ejecución remota detectó que `tests/globalSetup.js` asumía que la
carpeta `tmp/` ya existía. En Windows esa carpeta local ocultaba el defecto; en
un clon limpio de Linux, `better-sqlite3` no podía crear el archivo.

El setup ahora crea explícitamente el directorio temporal antes de abrir la base.
Después de la corrección, la segunda ejecución terminó en verde.

## Límites y puerta de salida

- No había Docker ni un servicio PostgreSQL local disponible; el esquema se
  verificó con PGlite.
- El servicio PostgreSQL real se verificó dentro de GitHub Actions.
- La aplicación continúa usando SQLite como runtime hasta el Bloque 4.

La puerta del Bloque 3 queda cerrada. El siguiente trabajo técnico es el Bloque
4, manteniendo SQLite intacto hasta validar conteos, relaciones y rollback sobre
PostgreSQL.
