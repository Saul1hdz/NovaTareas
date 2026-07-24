# Cierre del Bloque 1 - Seguridad crítica

Fecha: 24 de julio de 2026

Rama: `testing`

Alcance: desarrollo y pruebas locales cerradas con usuarios ficticios.

## Veredicto

El Bloque 1 queda técnicamente cerrado. NovaTareas puede seguir usándose en el
servidor local de pruebas, limitado a `localhost`. Este cierre no autoriza un
despliegue en Netcup ni una apertura al público.

## Dependencias

La actualización se hizo por saltos mayores, verificando cada etapa:

- Astro 4 → 5 → 6 → 7.1.3.
- `@astrojs/node` 11.0.2 y `@astrojs/react` 6.0.1.
- Vitest y `@vitest/coverage-v8` 4.1.10.
- Sharp 0.35.3 para decodificar y normalizar avatares.
- Runtime fijado a Node `>=22.12.0 <23.0.0`.

Referencias oficiales consultadas:

- [Migración de Astro 5](https://docs.astro.build/en/guides/upgrade-to/v5/)
- [Migración de Astro 6](https://docs.astro.build/en/guides/upgrade-to/v6/)
- [Migración de Astro 7](https://docs.astro.build/en/guides/upgrade-to/v7/)
- [Migración de Vitest](https://vitest.dev/guide/migration)
- [Entradas y límites de Sharp](https://sharp.pixelplumbing.com/api-input/)

`npm audit` pasó de 11 avisos (5 moderados, 4 altos y 2 críticos) a 0.

## Separación de credenciales de IA

| Credencial | Uso | Exposición permitida |
| --- | --- | --- |
| `ZAI_API_KEY` | Autentica al servidor de NovaTareas ante z.ai | Solo servidor |
| `AI_API_KEY` | Autoriza clientes cerrados a usar `POST /api/v1/recommend` | Solo clientes autorizados |

La API externa nunca devuelve la clave del proveedor. Tampoco se debe reutilizar
`ZAI_API_KEY` como `AI_API_KEY`. En CI ambas integraciones se aíslan con valores
ficticios o fallback local para no consumir saldo.

## Controles cerrados

- Recuperación y sesiones endurecidas: tokens criptográficos, expiración, un
  solo uso, rate limiting e invalidación de sesiones al cambiar contraseña.
- Ownership verificado en tareas, subtareas, historial, comentarios e IA.
- Validación de inputs de tareas, filtros, fechas, perfil, tema, Google y
  creación desde Telegram.
- Renderizado de datos externos mediante nodos DOM y `textContent`; no quedan
  usos de `innerHTML` en el dashboard.
- Avatares limitados a 2 MB, verificados por firma y decodificación real,
  redimensionados y normalizados a WebP.
- Cron y webhook fallan de forma cerrada con secretos ausentes o incorrectos.
- La API de recomendaciones exige `Authorization: Bearer <AI_API_KEY>`.
- Logs de errores externos reducidos a resúmenes que no incluyen bodies, tokens
  ni claves.

## Evidencia de cierre

- 55 pruebas automatizadas aprobadas en 7 archivos.
- Cobertura ejecutable con Vitest 4.
- `astro check`: 0 errores y 0 advertencias; las sugerencias restantes no
  bloquean el build.
- Build SSR aprobado con Astro 7 y el adaptador Node.
- Migraciones SQLite transaccionales e idempotentes verificadas.
- QA real en navegador sobre el servidor local.

## Riesgos fuera de este bloque

- SQLite sigue siendo temporal; PostgreSQL se diseña en el Bloque 2 y la
  migración de datos corresponde al Bloque 4.
- Google Calendar, recordatorios y conversación completa de Telegram todavía
  requieren pruebas funcionales más amplias.
- El rate limiting vive en memoria y no sirve para varias instancias.
- El dashboard sigue siendo monolítico y conserva handlers inline estáticos.
- No se ha preparado ni autorizado Netcup.

## Siguiente etapa

El siguiente trabajo es el Bloque 2: acordar el modelo PostgreSQL, escoger y
probar la capa de acceso a datos, crear migraciones reproducibles y documentar
el esquema. No se migrarán datos reales ni se desplegará todavía.
