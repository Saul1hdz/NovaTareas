# Registro de cambios

Todas las versiones publicadas de NovaTareas Pro, la más reciente primero.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
versionado es [semántico](https://semver.org/lang/es/): con el contrato de
`/api/v1/` como referencia, un cambio incompatible sube la primera cifra.

Lo que se publicó exactamente en cada versión —código, contrato, modelo, prompt,
migraciones, imagen y pruebas— está declarado en
[`release-manifest.yml`](release-manifest.yml).

---

## [1.0.0] — 2026-08-19

Primera versión publicada. Está en línea en
<https://novatareas.polarzero.dev> con dominio y HTTPS propios.

### Qué incluye

**Gestión de tareas**
- Tareas con prioridad, etiquetas, fecha límite, subtareas, comentarios de
  avance e historial automático de cambios.
- Modo colaborativo: una tarea privada se comparte con un enlace de invitación y
  cada persona entra con un nivel (lector, comentarista o editor). Las
  invitaciones caducan y se canjean una sola vez.
- Panel con estadísticas y la tarea que conviene priorizar ahora.

**Inteligencia artificial**
- Recomendaciones generadas con `glm-4.5-flash` (z.ai), con cascada de respaldo:
  Ollama local, luego el historial propio del usuario, y por último reglas
  deterministas. El servicio siempre responde, y cada recomendación guarda de
  qué escalón salió.
- Valoración 👍/👎 de cada recomendación, que realimenta el siguiente prompt.
- Capacidad expuesta como API externa protegida: `/api/v1/health`,
  `/api/v1/health/ready`, `/api/v1/metadata` y `/api/v1/recommend`, con contrato
  de entrada y salida publicado por el propio servicio.

**Bot de Telegram**
- Crear tareas conversando y pedir recomendaciones desde el chat.
- Avisos automáticos al crear, completar, volverse urgente, estar por vencer o
  vencer una tarea.
- Recordatorios recurrentes según la prioridad —urgente cada hora, alta cada 3,
  media cada 5, baja cada 6— con horas de silencio configurables. Vienen
  apagados: se encienden con `TASK_NUDGES_ENABLED`.

**Cuentas y seguridad**
- Registro con confirmación de correo y recuperación de contraseña por SMTP, con
  tokens de un solo uso. Las preguntas de seguridad se retiraron.
- Protección CSRF en un middleware único, que funciona también detrás de un
  proxy que termina el HTTPS.
- Límites de intentos persistidos en PostgreSQL, válidos entre reinicios y entre
  instancias.
- Tokens de Google cifrados con AES-256-GCM; el esquema rechaza guardarlos en
  claro.
- Avatares validados por su contenido, no por el tipo que declaran.

**Observabilidad y operación**
- Un evento JSON por solicitud con identificador de correlación, ruta, estado,
  duración y versión. El mismo identificador viaja al cliente en `x-request-id`.
- Medición repetible de rendimiento con p50, p95, máximo y tasa de error, más el
  análisis de cuello de botella y el plan de escalabilidad en
  [`docs/OBSERVABILIDAD_SEMANA_5.md`](docs/OBSERVABILIDAD_SEMANA_5.md).
- Despliegue con `compose.prod.yml`, sonda de salud que consulta la base de
  datos y runbook completo en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

**Calidad**
- 202 pruebas automatizadas en 30 archivos, todas contra PostgreSQL 16 real.
- Pipeline en GitHub Actions que revisa tipos, migra una base efímera, corre las
  pruebas con cobertura, compila, **construye la imagen de producción y la
  arranca** para comprobar que responde antes de dar el build por bueno.

### Cambios respecto al inicio del proyecto

| | Antes | En 1.0.0 |
|---|---|---|
| Base de datos | SQLite provisional | PostgreSQL 16 como motor único |
| Pruebas | 55 en 7 archivos | 202 en 30 archivos |
| Integración continua | No había | GitHub Actions, con arranque real de la imagen |
| Capacidad de IA | Acoplada al dashboard | Desacoplada y expuesta en `/api/v1/` |
| Calidad de las recomendaciones | Sin forma de medirla | Valoración 👍/👎 que realimenta el prompt |
| Límites de intentos | En memoria del proceso | Persistidos en PostgreSQL |
| Recuperación de cuenta | Preguntas de seguridad | Correo verificado con token de un solo uso |
| Tareas | Individuales | Modo colaborativo con tres niveles |
| Observabilidad | Sin logs ni métricas | Evento por solicitud y línea base medida |
| Disponibilidad | Nada publicado | En línea con HTTPS |

### Limitaciones conocidas

Dichas de frente, para que nadie las descubra tarde:

- **La publicación es manual.** El pipeline construye y arranca la imagen, pero
  no despliega; cada versión se sube siguiendo el runbook.
- **Una sola instancia de bot.** Usa polling, y dos procesos con el mismo token
  se roban los mensajes. La web sí puede escalar.
- **Sin segundo factor.** Una contraseña comprometida da acceso completo.
- **El contenido de las tareas no está cifrado en reposo.** Solo lo están los
  tokens de Google.
- **La confirmación de cuenta depende del servidor de correo.** Si el SMTP no
  responde, nadie puede registrarse ni recuperar su contraseña.
- **La cobertura se mide pero no se exige**: no hay umbral que rompa el pipeline.
- **Quedan huecos de prueba**: la conversación completa del bot, el RAG de
  extremo a extremo y el flujo visual del dashboard.
- **El RAG está conectado a medias**: los vectores existen, pero no todas las
  rutas los consumen.
- **Google Calendar está a medio camino**: OAuth y tokens funcionan y están
  probados, pero falta conectarlo al dashboard.
- **`src/pages/dashboard.astro` pasa de las 3.900 líneas**, con el CSS y el
  JavaScript de cliente dentro. Es la deuda que más estorba.

El detalle está en el README (sección 15) y en
[`docs/SEGURIDAD.md`](docs/SEGURIDAD.md).

### Volver a esta versión

```bash
sudo /usr/local/sbin/novatareas-release deploy-<sha40-de-esta-version>
```

Producción no construye: despliega la imagen que CI publicó en GHCR, así que
volver a una versión es volver a desplegar su imagen.

Con una advertencia: **volver el código no revierte el esquema**. Si una versión
posterior aplicó migraciones, primero se restaura la copia de `pg_dump` previa.
Procedimiento completo en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md), sección 9.

[1.0.0]: https://github.com/Saul1hdz/NovaTareas/releases/tag/v1.0.0
