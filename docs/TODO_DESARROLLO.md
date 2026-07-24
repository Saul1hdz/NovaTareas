# TODO de desarrollo - NovaTareas Pro

Este documento convierte el plan técnico en un backlog ejecutable para la rama
`testing`. El objetivo final es una demo universitaria cerrada en Netcup, con
usuarios y datos ficticios. No es un lanzamiento comercial ni público.

## Estado inicial

- [x] Analizar estáticamente el repositorio.
- [x] Documentar riesgos, migración a PostgreSQL y estrategia de ambientes.
- [x] Crear el PDF explicativo del plan.
- [x] Crear y activar la rama local `testing`.
- [ ] Confirmar integrantes responsables y fecha objetivo de la demostración.
- [x] Confirmar que esta copia no contiene una base SQLite que deba conservarse.

## Reglas de trabajo

- Ejecutar únicamente `npm run db:init` o el `npm run migrate` actual. El
  migrador seguro no llama a los scripts heredados y rechaza bases no inventariadas.
- No trabajar directamente en `main`.
- No hacer commit, push, merge o despliegue sin revisar antes el diff y las
  verificaciones correspondientes.
- No usar datos personales reales. Local, CI, staging y demo usarán información
  ficticia.
- Staging y demo final no compartirán base de datos, secretos ni volúmenes.
- Cada bloque se cierra con evidencia antes de iniciar el siguiente.

---

## Bloque 0 - Línea base y protección de datos

Prioridad: crítica.

### Repositorio y dependencias

- [x] Ejecutar `npm ci` con la versión de Node compatible con el proyecto.
- [x] Registrar versiones efectivas de Node, npm, Astro, React y SQLite.
- [x] Ejecutar y guardar el resultado inicial de:
  - [x] `npm test`
  - [x] `npm run lint`
  - [x] `npm run build`
- [x] Clasificar cada fallo como problema del entorno, del código o de los tests.
- [x] Revisar que `.env.example` contenga todas las variables requeridas y
  únicamente placeholders.
- [x] Ejecutar `npm audit` y registrar 5 avisos moderados, 4 altos y 2 críticos.

### Base SQLite

- [x] Localizar cualquier archivo `novatareas.db` usado por el equipo.
- [x] Confirmar que no hay una base local que respaldar, inventariar o validar.
- [ ] Si otro integrante entrega una base, crear una copia de solo lectura y
  registrar su hash, esquema, conteos, integridad y naturaleza ficticia.

### Bloquear el riesgo de migraciones

- [x] Retirar `002_new_user_schema.cjs` del comando normal de migración.
- [x] Evitar que cualquier arranque ejecute migraciones destructivas.
- [x] Añadir una protección temporal que rechazara el comando normal de migración.
- [x] Reemplazarla por un migrador seguro, transaccional e idempotente.

### Puerta de salida

- [x] Dependencias instalables de forma reproducible con Node 22.12 o posterior
  dentro de la línea 22.
- [x] Resultados iniciales de test, lint y build registrados.
- [x] Base existente respaldada o confirmación de que no hay datos que conservar.
- [x] Ningún comando habitual puede borrar usuarios o tareas.

---

## Bloque 1 - Seguridad crítica

Prioridad: crítica. Puede avanzar en paralelo con la preparación de tests.

### Dependencias vulnerables

- [x] Investigar las guías oficiales compatibles para migrar Astro 4 a una
  versión corregida, junto con `@astrojs/node` y `@astrojs/react`.
- [x] Actualizar Vitest y `@vitest/coverage-v8` de forma controlada.
- [x] Ejecutar `npm audit`, tests, lint, build y pruebas de navegador después de
  cada salto mayor.
- [x] Mantener el servidor de desarrollo limitado a `localhost`.

### Recuperación y sesión

- [x] Eliminar toda eliminación automática de cuentas por respuestas fallidas.
- [x] Sustituir `Math.random()` por tokens generados con `node:crypto`.
- [x] Hacer los tokens de recuperación de un solo uso y con expiración.
- [x] Aplicar rate limiting a recuperación y login.
- [x] Guardar respuestas de seguridad con hash o sustituirlas por un mecanismo
  más seguro para la demo.
- [x] Configurar cookies con `HttpOnly`, `Secure` y `SameSite`.
- [x] Invalidar sesiones anteriores después de cambiar la contraseña.

### XSS y validación de inputs

- [x] Eliminar `innerHTML` cuando contenga títulos, historial, comentarios o
  respuestas de IA.
- [x] Eliminar handlers `onclick` construidos con texto del usuario.
- [x] Renderizar datos de tareas con escape o `textContent`.
- [x] Validar título, descripción, etiqueta, prioridad, estado y fecha en el
  servidor.
- [x] Limitar tamaños de campos de tareas y comentarios.
- [x] Validar contenido real y tamaño de avatares, no solo su extensión.

### Rutas e integraciones

- [x] Hacer obligatorio `CRON_SECRET` y fallar de forma cerrada si falta.
- [x] Validar el secreto del webhook de Telegram.
- [x] Escapar texto antes de enviarlo con `parse_mode: HTML` a Telegram.
- [x] Añadir y validar `state` en Google OAuth.
- [x] Evitar que tokens o claves aparezcan en respuestas y logs.
- [x] Proteger la API inteligente externa con una `AI_API_KEY` independiente de
  la clave privada del proveedor `ZAI_API_KEY`.

### Tests de seguridad

- [x] Respuestas de recuperación incorrectas no eliminan una cuenta.
- [x] Un usuario no puede leer ni modificar tareas de otro.
- [x] Cron sin secreto devuelve `401`.
- [x] Webhook falsificado es rechazado.
- [x] Payloads con HTML y scripts se validan y se muestran como texto en el flujo probado.
- [x] `state` de Google alterado o ausente es rechazado por el verificador.

### Puerta de salida

- [x] No quedan rutas conocidas que permitan borrar cuentas externamente.
- [x] Ownership validado en todas las rutas de tareas, subtareas e historial.
- [x] Inputs externos se validan antes de escribir en la base.
- [x] Tests negativos de seguridad aprobados.

---

## Bloque 2 - Esquema reproducible y PostgreSQL

Prioridad: alta. No migrar datos antes de cerrar el diseño.

### Diseño

- [ ] Adoptar Drizzle ORM y Drizzle Kit, salvo que el equipo documente otra
  decisión.
- [x] Crear una migración inicial SQLite completa para una base vacía.
- [x] Definir todas las tablas actuales en SQLite:
  - [x] `users`
  - [x] `security_questions`
  - [x] `categories`
  - [x] `tasks`
  - [x] `subtasks`
  - [x] `task_history`
  - [x] `task_comments`
  - [x] `task_embeddings`
- [ ] Crear una tabla separada para recomendaciones de IA.
- [x] Definir columnas actuales de Google Calendar en el esquema SQLite.
- [x] Crear un registro real de migraciones aplicadas.

### Tipos y restricciones

- [x] Correo `NOT NULL`, único y sin distinción de mayúsculas en SQLite.
- [x] Estados y prioridades con valores permitidos.
- [ ] `DATE` para fecha límite sin hora.
- [ ] `TIMESTAMPTZ` para recordatorios con instante específico.
- [ ] Timestamps de auditoría con zona horaria.
- [x] Claves foráneas y políticas `ON DELETE` explícitas en SQLite.
- [x] Índices por usuario, estado, prioridad, fecha y archivado en SQLite.
- [ ] Cifrar tokens persistidos de Google.

### Acceso a datos

- [ ] Crear repositorios compartidos para usuarios, tareas y comentarios.
- [ ] Retirar SQL duplicado de páginas, bot y scripts.
- [ ] Sustituir consultas específicas de SQLite:
  - [ ] `GROUP_CONCAT`
  - [ ] `datetime('now')`
  - [ ] `unixepoch()`
  - [ ] booleanos `0/1`
  - [ ] obtención del último ID insertado
- [ ] Ejecutar operaciones relacionadas dentro de transacciones.

### Puerta de salida

- [ ] Una base PostgreSQL vacía se crea con un solo comando.
- [x] Repetir las migraciones SQLite actuales no elimina ni duplica datos.
- [ ] Diagrama y diccionario de datos actualizados.
- [x] Tests del esquema y las migraciones SQLite actuales aprobados.

---

## Bloque 3 - Suite de pruebas

Prioridad: alta. Debe crecer junto con cada corrección.

### Pruebas automáticas

- [ ] Registro, login, logout y cambio de contraseña.
- [ ] Recuperación de contraseña y rate limiting.
- [ ] CRUD completo de tareas.
- [ ] Completar, reabrir, archivar y desarchivar.
- [ ] Ownership entre dos usuarios ficticios.
- [ ] Subtareas, historial y comentarios.
- [ ] Fechas vencidas, próximas y zona `America/El_Salvador`.
- [ ] Recordatorios enviados una sola vez.
- [ ] Telegram, cron y Google con servicios simulados.
- [ ] z.ai disponible, Ollama disponible y fallback sin red.
- [ ] Creación y reejecución de migraciones.

### CI

- [ ] Ejecutar `npm ci`, lint, tests y build en GitHub Actions.
- [ ] Usar una base PostgreSQL efímera para tests de integración.
- [ ] No utilizar claves reales ni consumir saldo de IA en CI.
- [ ] Guardar reportes de cobertura sin perseguir un porcentaje artificial.
- [ ] Bloquear integración cuando falle una verificación crítica.

### Puerta de salida

- [ ] Flujos críticos deterministas en local y CI.
- [ ] Tests no dependen de servicios externos reales.
- [ ] Fallos muestran información suficiente para reproducirse.

---

## Bloque 4 - Migración SQLite a PostgreSQL

Prioridad: alta. Solo aplica si existe información que conservar.

- [ ] Crear exportador de SQLite en modo solo lectura.
- [ ] Conservar identificadores originales cuando sea posible.
- [ ] Transformar fechas, booleanos, correos y estados.
- [ ] Importar tablas en orden de dependencias y dentro de transacciones.
- [ ] Comparar conteos por tabla antes y después.
- [ ] Verificar claves foráneas y filas huérfanas.
- [ ] Verificar hashes de contraseña mediante login, sin exponerlos.
- [ ] Comparar muestras funcionales por usuario ficticio.
- [ ] Ensayar la migración al menos dos veces desde una copia limpia.
- [ ] Mantener SQLite intacto hasta aceptar PostgreSQL.
- [ ] Documentar rollback.

### Puerta de salida

- [ ] Conteos y relaciones equivalentes.
- [ ] Login y tareas funcionan sobre PostgreSQL.
- [ ] Migración y rollback reproducibles.

---

## Bloque 5 - Arquitectura y mantenibilidad

Prioridad: media-alta.

- [ ] Unificar proveedor, modelo, prompts, timeouts y fallbacks de IA.
- [ ] Registrar fuente de cada recomendación: z.ai, Ollama, historial o reglas.
- [ ] Separar recomendaciones de IA de las subtareas reales.
- [ ] Dividir gradualmente `dashboard.astro` en módulos y componentes.
- [ ] Separar lógica de presentación, llamadas API y estado del calendario.
- [ ] Retirar módulos muertos de la migración abandonada a Supabase.
- [ ] Eliminar configuración y nombres heredados de Gemini que ya no apliquen.
- [ ] Corregir discrepancias del modelo z.ai predeterminado.
- [ ] Definir claramente los procesos web, bot y scheduler.
- [ ] Persistir o manejar de forma explícita el estado conversacional del bot.

### Puerta de salida

- [ ] Una regla de negocio se implementa una sola vez.
- [ ] Web, API y Telegram producen comportamientos coherentes.
- [ ] El dashboard puede modificarse sin tocar un archivo monolítico.

---

## Bloque 6 - Funciones e integraciones

Prioridad: media.

### Telegram y recordatorios

- [ ] Corregir el flujo de errores al crear tareas desde Telegram.
- [ ] Validar que las categorías pertenezcan al usuario vinculado.
- [ ] Conservar o recuperar sesiones del bot tras reinicios.
- [ ] Separar fecha límite de fecha y hora de recordatorio.
- [ ] Reprogramar avisos cuando cambie la fecha.
- [ ] Verificar que avisos próximos y vencidos no se repitan.

### Google Calendar

- [ ] Completar conexión, consulta y desconexión.
- [ ] Manejar expiración y renovación de tokens.
- [ ] Mostrar estados de conexión y errores en el dashboard.
- [ ] Probar rangos de fechas y eventos de día completo.

### IA y RAG

- [ ] Indexar historial de forma consistente.
- [ ] Reindexar cuando una tarea archivada cambie.
- [ ] Validar dimensiones y modelo de embeddings.
- [ ] Limitar costo y frecuencia por usuario.
- [ ] Mostrar cuándo se utilizó un fallback.

### Archivos y avatares

- [ ] Evitar acumulación de avatares antiguos.
- [ ] Preparar una abstracción de almacenamiento persistente.
- [ ] Probar contenido inválido, archivos grandes y nombres maliciosos.

---

## Bloque 7 - Interfaz y QA en navegador

Prioridad: media.

- [x] Registro crea la cuenta e inicia la sesión sin devolver silenciosamente al login.
- [x] Logout reemplaza el historial y las páginas autenticadas desactivan caché.
- [x] Reabrir una tarea archivada funciona desde la vista Archivo.
- [x] Crear una tarea limpia filtros de prioridad y etiqueta que podrían ocultarla.
- [x] La agenda muestra únicamente los eventos del mes seleccionado.
- [x] Recuperación no revela si el correo existe y permite volver al login.
- [x] Telegram usa códigos temporales de un solo uso en vez de pedir contraseña.
- [ ] Probar registro y login en escritorio y móvil.
- [ ] Probar listas vacías, muchas tareas y textos largos.
- [ ] Probar modales, Escape, foco inicial y restauración de foco.
- [ ] Probar calendario, cambio de mes y eventos de Google.
- [ ] Probar mensajes de error cuando la API falla.
- [ ] Revisar navegación completa con teclado.
- [ ] Revisar contraste, labels y nombres accesibles.
- [ ] Revisar anchos móviles representativos y escritorio.
- [x] Eliminar logs de depuración visibles del dashboard.
- [ ] Ejecutar un smoke test completo después de cada cambio importante.

### Puerta de salida

- [ ] No hay bloqueos funcionales en móvil o escritorio.
- [ ] Los errores son visibles y recuperables.
- [ ] Los flujos principales funcionan con teclado.

---

## Bloque 8 - Staging en Netcup

Prioridad: después de cerrar los riesgos críticos.

- [ ] Crear subdominio de staging separado.
- [ ] Restringir acceso al equipo mediante autenticación adicional.
- [ ] Configurar HTTPS.
- [ ] Separar procesos de web, bot y scheduler.
- [ ] Crear PostgreSQL exclusivo de staging.
- [ ] No exponer el puerto `5432` públicamente.
- [ ] Usar secretos exclusivos de staging y fuera de Git.
- [ ] Crear datos ficticios reproducibles.
- [ ] Identificar cada versión desplegada con su commit.
- [ ] Ejecutar migraciones, smoke tests y QA después de cada despliegue.
- [ ] Respaldar antes de migraciones o cambios de esquema.

### Puerta de salida

- [ ] El equipo puede probar el sistema sin acceso público abierto.
- [ ] Staging puede reiniciarse sin afectar la demo final.
- [ ] Los fallos del servidor pueden reproducirse localmente.

---

## Bloque 9 - Demo final cerrada y cierre

- [ ] Crear ambiente de demo separado de staging.
- [ ] Deshabilitar registro abierto o utilizar cuentas ficticias precreadas.
- [ ] Limitar acceso a equipo, docentes e invitados.
- [ ] Etiquetar el commit candidato a demostración.
- [ ] Ejecutar suite, lint, build y smoke test final.
- [ ] Probar restauración de PostgreSQL.
- [ ] Preparar rollback a la versión anterior.
- [ ] Preparar guion y datos para la demostración.
- [ ] Documentar instalación, variables, migraciones y limitaciones.
- [ ] Archivar evidencias de pruebas y versión final.
- [ ] Definir fecha de apagado del servicio temporal.
- [ ] Al terminar, exportar lo necesario, revocar accesos y apagar contenedores.
- [ ] Confirmar que no queden secretos o servicios olvidados en el VPS.

## Definición global de terminado

- [ ] Un clon limpio puede instalarse sin una base heredada.
- [ ] No hay migraciones destructivas en el flujo normal.
- [ ] PostgreSQL es la fuente principal de datos.
- [ ] Autenticación, ownership, tareas y fechas tienen pruebas.
- [ ] Web, Telegram, Google e IA siguen reglas coherentes.
- [ ] Staging y demo utilizan únicamente usuarios ficticios.
- [ ] La demo final es reproducible desde un commit identificado.
- [ ] El proyecto puede archivarse y apagarse de manera ordenada.
