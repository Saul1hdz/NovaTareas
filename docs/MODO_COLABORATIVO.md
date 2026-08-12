# Modo colaborativo

Cómo funciona el trabajo en equipo sobre una misma tarea: quién puede hacer qué,
cómo se invita a alguien y qué se guarda en la base.

## Idea general

Una tarea nace **privada**: solo la ve su propietario. Cuando este quiere
trabajarla con otras personas genera un **enlace de invitación** con un nivel
concreto. Quien abre el enlace, inicia sesión y acepta queda añadido como
colaborador de esa tarea —y solo de esa tarea.

No hay equipos ni espacios de trabajo: el permiso es siempre por tarea. Esto
mantiene el modelo simple y evita que compartir una tarea abra el resto del
tablero de nadie.

## Niveles

| Nivel | Ver tarea, historial y comentarios | Comentar y aportar ideas | Editar la tarea y sus subtareas | Archivar, borrar, invitar y administrar |
|---|:--:|:--:|:--:|:--:|
| Lector | ✔ | | | |
| Comentarista | ✔ | ✔ | | |
| Editor | ✔ | ✔ | ✔ | |
| Propietario | ✔ | ✔ | ✔ | ✔ |

El propietario es siempre `tasks.user_id` y no se guarda como colaborador. Los
demás viven en `task_collaborators` con uno de los tres niveles.

Reglas que conviene tener presentes:

- Un editor **no** puede archivar, borrar ni cambiar la visibilidad. Esas
  acciones destruyen o esconden trabajo ajeno, así que quedan en el propietario.
- Aceptar un enlace de nivel bajo **no degrada** a quien ya colabora con un nivel
  más alto.
- Quien no participa en la tarea recibe **404**, no 403: la respuesta no revela
  que la tarea exista. El 403 se reserva para quien sí participa pero se queda
  corto de nivel.

## Enlaces de invitación

- El enlace es `/unirse/<token>`, con un token de 24 bytes aleatorios.
- En la base **solo se guarda su SHA-256** (`task_invites.token_hash`), igual que
  con los códigos de Telegram y los tokens de recuperación. Por eso el enlace
  completo se muestra una única vez, al crearlo: después ya no se puede
  reconstruir.
- Cada enlace lleva nivel, caducidad (1 a 30 días) y número máximo de usos
  (`0` = sin límite).
- El canje ocurre dentro de una transacción con la fila bloqueada
  (`FOR UPDATE`), para que dos personas que abren el mismo enlace a la vez no
  puedan superar el cupo.
- El propietario puede revocar un enlace concreto o todos a la vez. Revocar no
  expulsa a quien ya entró; para eso se quita al colaborador.
- Generar enlaces tiene cuota (20 por hora y usuario) y aceptarlos también
  (30 cada 15 minutos por IP).

Si alguien abre el enlace sin sesión iniciada, la página lo manda al login con
`?next=/unirse/<token>` y vuelve a la invitación al autenticarse. Solo se acepta
ese destino: cualquier otro valor de `next` se ignora para no convertir el login
en un redirector abierto.

> **Solo se puede invitar a quien ya tiene cuenta.** El registro público está
> cerrado salvo que se active `REGISTRATION_ENABLED=true`, así que un enlace no
> sirve para dar de alta a nadie. La página de invitación lo dice explícitamente
> cuando el registro está deshabilitado, en lugar de ofrecer crear una cuenta que
> el servidor va a rechazar con 403.

## Comentarios e ideas

`task_comments` distingue dos tipos con la columna `kind`:

- `comentario` — seguimiento y avance, el comportamiento de siempre.
- `idea` — una propuesta para el equipo, que la interfaz resalta.

Cuando se pide ayuda a la IA, el prompt incluye el autor de cada comentario y
avisa de que la tarea es colaborativa, para que no lea como un monólogo lo que en
realidad es una conversación entre varias personas.

El historial (`task_history`) ya guardaba el autor de cada cambio; ahora se
muestra, porque en una tarea compartida "Estado: pendiente → completada" no dice
nada si no se sabe quién lo hizo.

## Endpoints

Todos usan la sesión del dashboard (cookie o `Authorization: Bearer`).

| Método | Ruta | Nivel mínimo |
|---|---|---|
| GET | `/api/tasks` | — (devuelve propias y compartidas, con `my_role`, `is_owner` y `collaborator_count`) |
| POST | `/api/tasks` | — (acepta `visibility`: `privada` \| `colaborativa`) |
| PATCH | `/api/tasks/:id` | Editor; propietario para `archived` y `visibility` |
| DELETE | `/api/tasks/:id` | Propietario |
| GET | `/api/tasks/:id/history` | Lector |
| POST | `/api/tasks/:id/comments` | Comentarista (acepta `kind`) |
| POST | `/api/tasks/:id/ai` | Comentarista |
| PATCH | `/api/tasks/:id/subtasks/:subId` | Editor |
| GET | `/api/tasks/:id/collaborators` | Lector |
| PATCH | `/api/tasks/:id/collaborators/:userId` | Propietario |
| DELETE | `/api/tasks/:id/collaborators/:userId` | Propietario, o el propio colaborador para salirse |
| GET/POST/DELETE | `/api/tasks/:id/invites` | Propietario |
| DELETE | `/api/tasks/:id/invites/:inviteId` | Propietario |
| POST | `/api/invites/accept` | Sesión iniciada |

La lógica de niveles vive en `src/lib/collaboration.js`; las rutas solo la
consultan. Ahí están `getTaskAccess`, `can`, la creación y el canje de enlaces.

## Esquema

Migración `0002_familiar_puppet_master.sql`:

- `tasks.visibility` — enum `task_visibility` (`privada` por defecto).
- `task_comments.kind` — enum `comment_kind` (`comentario` por defecto).
- `task_collaborators` — tarea, usuario, nivel, quién invitó; único por par
  tarea/usuario.
- `task_invites` — hash del token, nivel, caducidad, usos, revocación.

## Interfaz

- **Nueva tarea** trae una casilla "Modo colaborativo". Al marcarla, la tarea se
  crea como colaborativa y se abre el panel de equipo para generar el enlace.
- Cada tarjeta muestra su estado: `🔒 Privada`, `👥 N` participantes o
  `Compartida · <nivel>` cuando la tarea es de otra persona. Los botones que el
  nivel no permite no se pintan.
- El botón **Equipo** abre el panel: participantes con su nivel, cambio de nivel,
  expulsión, generación de enlaces y lista de enlaces activos.
- El modal de **Historial** muestra el autor de cada cambio y de cada comentario,
  y permite elegir entre comentario e idea.

Que un botón no aparezca es comodidad, no seguridad: la API vuelve a comprobar el
nivel en cada petición.

## Pruebas

`tests/collaboration.test.js` recorre el flujo completo contra PostgreSQL real:
tarea privada invisible para terceros, generación y canje del enlace, límites de
nivel (comentarista que no edita, editor que no archiva, colaborador que no
administra), cupo de usos agotado, enlace revocado y retirada de acceso al quitar
a un colaborador.
