# Seguridad de NovaTareas Pro

Qué protegemos, de qué, con qué control y qué prueba lo respalda. Lo que aquí no
aparece es porque no está resuelto: al final hay una lista explícita de lo que
queda fuera del alcance.

Este documento reúne lo que antes estaba repartido entre
[`CIERRE_BLOQUE_1.md`](CIERRE_BLOQUE_1.md), [`MODO_COLABORATIVO.md`](MODO_COLABORATIVO.md)
y [`DESPLIEGUE.md`](DESPLIEGUE.md).

---

## 1. Qué hay que proteger

| Activo | Por qué importa |
|---|---|
| Cuentas y sesiones | Dan acceso a todo lo demás |
| Tareas y comentarios | Contenido personal: entregas, notas, avances |
| Tokens de Google | Permiten leer el calendario del usuario |
| Vinculación de Telegram | Un chat vinculado recibe los avisos de esa persona |
| Credenciales de IA | Su uso indebido consume saldo real |
| La propia disponibilidad | Es lo que se cae primero si alguien abusa |

---

## 2. Controles activos

### Identidad y sesión

| Control | Dónde | Prueba |
|---|---|---|
| Contraseñas con bcrypt, nunca en claro | `src/lib/auth.js` | `appFlows.test.js` |
| Sesión como JWT firmado con `SECRET_KEY`, con versión y vencimiento | `src/lib/auth.js` | `security.test.js` |
| Cookie `HttpOnly`, `SameSite=Lax`, `Secure` bajo HTTPS o producción | `src/lib/auth.js` | `security.test.js` |
| Invalidación de sesiones por versión: cambiar la contraseña tumba las anteriores | `src/lib/auth.js` | `appFlows.test.js` |
| Confirmación de correo antes del primer inicio de sesión | `src/lib/emailVerification.js` | `emailVerification.test.js` |
| Tokens de verificación y recuperación de **un solo uso** y con caducidad | `src/lib/emailVerification.js` | `emailVerification.test.js` |
| La recuperación responde igual exista o no la cuenta (no enumera usuarios) | `src/pages/api/auth/recover.js` | `emailVerification.test.js` |
| Registro público cerrable con `REGISTRATION_ENABLED` | `src/pages/api/register.js` | `registerSecurity.test.js` |

La cookie dura siete días. `SameSite=Lax` frena el envío en peticiones de
terceros, pero no basta por sí sola: de ahí el control siguiente.

### Origen de las peticiones (CSRF)

Toda mutación pasa por `src/middleware.js`, que rechaza con **403** cualquier
petición que traiga cookie de sesión y declare un origen que no es el nuestro.

Tres decisiones que conviene entender:

- **Se aplica solo a peticiones con cookie de sesión.** Las que se autentican con
  `Bearer` no pueden ser víctimas de CSRF: el navegador no adjunta esa cabecera
  sola.
- **Falla cerrado.** Si no se puede determinar el origen, se rechaza.
- **Respeta `X-Forwarded-Proto`.** Detrás de un proxy que termina el HTTPS, el
  servidor se ve a sí mismo en `http` y compararía contra el origen equivocado.
  Esto ya provocó un incidente real en producción: todas las creaciones de tarea
  fallaban con «Petición de origen cruzado rechazada».

Probado en `csrf.test.js` y `collaborationSecurity.test.js`, y verificado a mano
contra el servidor: origen cruzado con sesión → 403; mismo origen → pasa.

### Autorización

| Control | Dónde | Prueba |
|---|---|---|
| Toda consulta de tareas filtra por propietario o colaborador | `src/lib/db.js`, `src/db/postgres/` | `postgresSchema.test.js`, `appFlows.test.js` |
| Tres niveles: lector < comentarista < editor | `src/lib/collaboration.js` | `collaboration.test.js` |
| Solo el propietario borra la tarea o la vuelve privada | `src/lib/collaboration.js` | `collaborationSecurity.test.js` |
| Volver privada una tarea corta el acceso de los colaboradores | `src/lib/collaboration.js` | `collaborationSecurity.test.js` |
| Las invitaciones caducan y se canjean una sola vez | `src/lib/collaboration.js` | `collaboration.test.js` |

### Límites de uso

Los contadores viven en la tabla `rate_limit_hits`, no en memoria: sobreviven al
reinicio del contenedor y seguirían valiendo con varias instancias. Comprobado
también bajo peticiones concurrentes en `security.test.js`.

| Qué se limita | Umbral |
|---|---|
| Inicio de sesión por correo | 5 intentos por ventana |
| Inicio de sesión por IP | 20 intentos por ventana |
| Recuperación por IP | 40 por ventana, y 5 por correo distinto |
| Recomendaciones de IA | Configurable con `AI_RATE_LIMIT_MAX` y `AI_RATE_LIMIT_WINDOW` |

También se limitan el registro, el canje de invitaciones y la generación de
códigos de Telegram.

### Datos sensibles en reposo

- **Tokens de Google cifrados con AES-256-GCM** (`src/lib/tokenEncryption.js`).
  El esquema rechaza guardarlos en claro, y un token manipulado no descifra:
  `postgresSchema.test.js` y `tokenEncryption.test.js`.
- **Secretos fuera del repositorio**: `.env` y `.env.local` están en
  `.gitignore`; lo versionado es `.env.example`, solo con marcadores.

### Integraciones

| Control | Dónde | Prueba |
|---|---|---|
| El webhook de Telegram exige `TELEGRAM_WEBHOOK_SECRET`, comparado en tiempo constante | `src/pages/api/telegram/webhook.js` | `integrationSecurity.test.js` |
| El cron exige `CRON_SECRET`: 200 con él, 401 sin él | `src/pages/api/cron/reminders.js` | `integrationSecurity.test.js` |
| La API externa exige `Bearer AI_API_KEY` | `src/pages/api/v1/recommend.js` | `api.test.js` |
| El `state` de Google OAuth va firmado y con nonce | `src/lib/auth.js` | `security.test.js` |
| Los avatares se validan **por contenido**, no por el tipo declarado; máximo 2 MB | `src/lib/avatarValidation.js` | `integrationSecurity.test.js` |

Validar el avatar por sus bytes y no por el `Content-Type` es lo que impide subir
un ejecutable diciendo que es un PNG.

### Lo que sale en los registros

El log publica **solo** los campos de una lista blanca declarada en
`src/lib/observability.js`. Nunca salen cuerpos, cabeceras, contraseñas, correos
ni el *query string*. Las rutas se normalizan antes de registrarse: los
segmentos numéricos pasan a `:id` y las cadenas largas —tokens y códigos de
invitación— a `:token`, así que un enlace de invitación no acaba en el log.
`observability.test.js` lo verifica.

Los errores de servicios externos se resumen con `safeErrorSummary()`, que no
arrastra URLs ni credenciales al log.

---

## 3. Casos adversariales probados

No son hipótesis: cada uno tiene una prueba que falla si el control desaparece.

| Intento | Resultado esperado | Prueba |
|---|---|---|
| Mutar una tarea desde otro sitio con la cookie de la víctima | 403 | `collaborationSecurity.test.js` |
| Leer o editar la tarea de otro usuario | 403 / no aparece | `appFlows.test.js` |
| Un colaborador «lector» intenta editar | Rechazado | `collaboration.test.js` |
| Un colaborador intenta borrar la tarea | «Solo el propietario puede eliminar la tarea» | `collaborationSecurity.test.js` |
| Reusar un token de verificación ya consumido | Rechazado | `emailVerification.test.js` |
| Averiguar si un correo existe por la respuesta de recuperación | Respuesta idéntica | `emailVerification.test.js` |
| Superar el límite de intentos con peticiones concurrentes | Bloqueado igual | `security.test.js` |
| Llamar al cron o al webhook sin secreto | 401 | `integrationSecurity.test.js` |
| Subir un ejecutable renombrado a `.png` | Rechazado | `integrationSecurity.test.js` |
| Guardar un token de Google sin cifrar | El esquema lo impide | `postgresSchema.test.js` |

---

## 4. En el servidor

- **HTTPS con certificado válido** en <https://novatareas.polarzero.dev>.
- **PostgreSQL sin puertos publicados** en `compose.prod.yml`: solo accesible
  desde la red interna de Docker.
- **Sonda de salud** (`/api/v1/health/ready`) que consulta la base, no solo el
  proceso.
- **Respaldos con `pg_dump`** y procedimiento de restauración documentado en
  [`DESPLIEGUE.md`](DESPLIEGUE.md).
- **Vuelta atrás** con la etiqueta `v1.0.0`, con la advertencia de que revertir
  el código no revierte las migraciones.

---

## 5. Qué queda fuera del alcance

Dicho de frente, para que nadie lo descubra tarde:

1. **No hay segundo factor.** Una contraseña comprometida da acceso completo.
2. **No hay auditoría de accesos.** Se registra quién cambió una tarea
   (`task_history`), pero no quién la leyó.
3. **No hay cifrado de las tareas en reposo.** Solo los tokens de Google están
   cifrados; el contenido de las tareas está en claro en la base de datos, así
   que quien tenga acceso al servidor lo lee.
4. **No hay rotación automática de secretos.** `SECRET_KEY` y las credenciales de
   integraciones se cambian a mano.
5. **El bot depende de un token único.** Quien lo obtenga puede suplantar al bot;
   por eso vive solo en el `.env` del servidor.
6. **No se ha hecho pentesting externo.** Todo lo de arriba está verificado con
   pruebas propias, que comprueban lo que sabemos que hay que comprobar.
7. **Sin límite de tamaño global por petición** más allá del avatar y de las
   validaciones de campo.

---

## 6. Si algo pasa

1. Revocar sesiones: cambiar `SECRET_KEY` invalida todas las cookies emitidas.
2. Cerrar el registro con `REGISTRATION_ENABLED=false`.
3. Localizar la actividad en el log por `request_id` (llega al cliente en la
   cabecera `x-request-id`).
4. Rotar la credencial afectada y volver a desplegar.
5. Si hubo daño en los datos, restaurar la copia de `pg_dump` anterior siguiendo
   [`DESPLIEGUE.md`](DESPLIEGUE.md).
