# API Inteligente — NovaTareas Pro

Documento de contratos de integración (Semana 2, Módulo 4).

La API expone la capacidad de IA del proyecto como un servicio para clientes
externos autorizados. Es independiente de la sesión del dashboard, pero
`POST /api/v1/recommend` exige `Authorization: Bearer <AI_API_KEY>`.

**URL base (desarrollo):** `http://localhost:4321`

---

## Endpoints

| Método | Ruta | Propósito |
|---|---|---|
| GET  | `/api/v1/health`       | Verificar que el servicio está activo. |
| GET  | `/api/v1/health/ready` | Comprobar que la base de datos responde. |
| GET  | `/api/v1/health/jobs`  | Comprobar que los trabajos programados siguen ejecutándose. |
| GET  | `/api/v1/metadata`     | Informar versión, modelo, propósito y contrato. |
| POST | `/api/v1/recommend`    | Ejecutar la capacidad inteligente principal. |

---

## 1. `GET /api/v1/health`

Verifica el estado del servicio y de sus dependencias.

**Respuesta exitosa (200):**

```json
{
  "status": "ok",
  "service": "novatareas-ai",
  "timestamp": "2026-07-16T04:00:00.000Z",
  "checks": {
    "zai_configured": true,
    "external_api_configured": true,
    "ollama_available": false,
    "fallback_rules": true
  }
}
```

> El estado es `ok` incluso si z.ai y Ollama están caídos, porque el servicio siempre puede responder con reglas locales como último recurso. **Por eso no sirve como sonda de disponibilidad**: para eso está `/api/v1/health/ready`.

---

## 1b. `GET /api/v1/health/ready`

Sonda de disponibilidad para orquestadores, proxies inversos y healthchecks de
contenedor. A diferencia de `/api/v1/health`, consulta la base de datos, que es
la dependencia sin la cual la aplicación no puede atender ninguna petición.

No requiere autenticación.

**Respuesta cuando la base responde — HTTP 200**

```json
{
  "status": "ok",
  "checks": { "database": true },
  "latency_ms": 1,
  "timestamp": "2026-07-25T20:14:05.089Z"
}
```

**Respuesta cuando la base no responde — HTTP 503**

```json
{
  "status": "unavailable",
  "checks": { "database": false },
  "timestamp": "2026-07-25T20:14:28.907Z"
}
```

Es la ruta que usan el `HEALTHCHECK` del Dockerfile, los healthchecks de ambos
ficheros compose y la comprobación de la imagen en integración continua.

---

## 1c. `GET /api/v1/health/jobs`

Sonda del estado de los **trabajos programados**. `/api/v1/health/ready`
comprueba que el servicio puede responder; esta comprueba que además está
haciendo su trabajo, que es una pregunta distinta.

Existe por un fallo real: el cron que llama a `/api/cron/reminders` nunca se
instaló en el servidor y los recordatorios de Telegram estuvieron meses sin
ejecutarse. La aplicación estuvo en verde todo ese tiempo —`/health/ready` en
200, la base sana, cero reinicios— porque un trabajo programado muerto no
produce errores: produce silencio, y el silencio no dispara nada.

No requiere autenticación, igual que `/api/v1/health/ready`: solo publica marcas
de tiempo y contadores, nunca datos de usuarios.

**Respuesta cuando todos los trabajos están al día — HTTP 200**

```json
{
  "status": "ok",
  "jobs": {
    "cron_reminders": {
      "last_run_at": "2026-08-20T19:00:00.000Z",
      "minutes_ago": 7,
      "expected_every_minutes": 15,
      "stale": false,
      "reason": null,
      "last_ok": true,
      "last_summary": {
        "reminders_sent": 0,
        "overdue_alerts": 0,
        "recurring_nudges_sent": 0,
        "recurring_nudges_skipped": "desactivado",
        "window_minutes": 30
      }
    }
  },
  "timestamp": "2026-08-20T19:07:03.114Z"
}
```

**Respuesta cuando algún trabajo no está sano — HTTP 503**

En este ejemplo el trabajo no se ha ejecutado nunca:

```json
{
  "status": "stale",
  "jobs": {
    "cron_reminders": {
      "last_run_at": null,
      "minutes_ago": null,
      "expected_every_minutes": 15,
      "stale": true,
      "reason": "stale",
      "last_ok": null,
      "last_summary": null
    }
  },
  "timestamp": "2026-08-20T19:01:31.020Z"
}
```

### Por qué un trabajo no está sano

`reason` separa los dos motivos, que **se investigan en sitios distintos**. Un
vigilante puede ponerlo tal cual en el mensaje de la alerta y quien lo lea ya
sabe dónde mirar:

| `reason` | Qué pasa | Dónde se mira |
|---|---|---|
| `"stale"` | Lleva más de 45 minutos sin ejecutarse, o no lo ha hecho nunca | El crontab del servidor |
| `"failing"` | Se ejecuta puntual, pero el último intento reventó | Los logs de la aplicación |
| `null` | Corrió hace poco y terminó bien | Nada que hacer |

El `status` de arriba toma el motivo que predomina: `"stale"` tapa a
`"failing"`, porque un trabajo que no corre se investiga antes que uno que corre
mal. Los valores posibles son `"ok"`, `"stale"` y `"failing"`.

### Reglas

| Regla | Valor y por qué |
|---|---|
| Umbral de `stale` | **45 minutos**: tres ciclos del cron de 15. Con uno solo, cualquier reinicio del contenedor produciría una alerta falsa. |
| Código de estado | **503** si algún trabajo tiene `reason`, **200** solo si todos están sanos. Así un vigilante con `curl -f` lo detecta sin saber leer JSON. |
| **Nunca ejecutado** | Cuenta como `stale`, **no** como `ok`. Ese era exactamente el caso real: cero ejecuciones en toda la historia del despliegue. Si diera verde, la sonda reproduciría el fallo que pretende detectar. |
| **Último intento fallido** | Cuenta como `failing`, aunque la marca sea de hace dos minutos. Un barrido que revienta cada ciclo tampoco está avisando a nadie: es el mismo fallo con otra cara. |
| Barrido fallido | Queda registrado con `last_ok: false` y la clase del error en `last_summary` —nunca su mensaje, que puede llevar datos de un usuario. |
| Sin contador de reintentos | Un fallo pasajero pone la sonda en rojo un ciclo y se resuelve solo quince minutos después. Ese ruido se acepta a cambio de no ser ciego ante un fallo permanente; un contador de intentos consecutivos complicaría el estado para poco. |

### Lo que esta ruta **no** hace

- **No avisa a nadie.** El aviso lo da un vigilante externo al servidor, porque
  quien avisa no puede ser quien está caído. Aquí solo se expone el estado.
- **No entra en el `HEALTHCHECK` del contenedor** ni en el del balanceador: un
  cron parado no es motivo para sacar la web de servicio. Para eso está
  `/api/v1/health/ready`, que sigue mirando únicamente la base de datos.

---

## 2. `GET /api/v1/metadata`

Devuelve información del servicio y el contrato de entrada/salida.

**Respuesta exitosa (200):** objeto con `version`, `primary_model`, `purpose`, `endpoints`, `input_contract` y `output_contract`.

---

## 3. `POST /api/v1/recommend`

Genera una recomendación de productividad para una tarea.

### Autenticación

El cliente debe enviar `Authorization: Bearer <AI_API_KEY>`. Esta credencial
autoriza el consumo de NovaTareas y es distinta de `ZAI_API_KEY`, que únicamente
usa el servidor para comunicarse con z.ai.

### Payload de entrada

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `titulo` | string | **Sí** | No vacío, máx. 200 caracteres. |
| `descripcion` | string | No | Máx. 1000 caracteres. |
| `prioridad` | string | No | `baja` \| `media` \| `alta` \| `urgente`. Por defecto `media`. |
| `tipo_usuario` | string | No | `comun` \| `estudiante` \| `empleado`. Por defecto `comun`. |
| `fecha_limite` | string | No | Formato `YYYY-MM-DD`. |

**Ejemplo de entrada:**

```json
{
  "titulo": "Terminar el informe de ventas del Q2",
  "descripcion": "Incluir gráficos comparativos y conclusiones",
  "prioridad": "alta",
  "tipo_usuario": "empleado",
  "fecha_limite": "2026-07-20"
}
```

### Respuesta exitosa (200)

```json
{
  "recomendacion": "Empieza por definir las 3 secciones principales del informe. Reúne primero los datos de ventas antes de escribir. Bloquea 1 hora hoy para el borrador de los gráficos.",
  "fuente": "zai",
  "tarea": {
    "titulo": "Terminar el informe de ventas del Q2",
    "descripcion": "Incluir gráficos comparativos y conclusiones",
    "prioridad": "alta",
    "tipo_usuario": "empleado",
    "fecha_limite": "2026-07-20"
  }
}
```

El campo `fuente` indica qué motor generó la respuesta: `zai` (modelo principal), `ollama` (fallback local) o `rules` (reglas heurísticas).

### Respuestas de error

| Código | Causa | Cuerpo |
|---|---|---|
| 401 | Bearer ausente o incorrecto | `{ "error": "No autorizado." }` |
| 503 | `AI_API_KEY` no configurada en el servidor | `{ "error": "API externa no configurada." }` |
| 400 | JSON malformado | `{ "error": "El cuerpo de la petición no es JSON válido." }` |
| 400 | Falta `titulo` | `{ "error": "El campo \"titulo\" es obligatorio y no puede estar vacío." }` |
| 400 | `prioridad` inválida | `{ "error": "El campo \"prioridad\" debe ser uno de: baja, media, alta, urgente." }` |
| 405 | Método incorrecto (GET) | `{ "error": "Método no permitido. Usa POST con un cuerpo JSON." }` |
| 429 | Demasiadas peticiones | `{ "error": "Demasiadas peticiones. Espera unos minutos e inténtalo de nuevo." }` |
| 500 | Error interno | `{ "error": "Error interno al generar la recomendación." }` |

### Validaciones aplicadas

- `titulo` obligatorio y no vacío.
- Límites de longitud en `titulo` (200) y `descripcion` (1000).
- `prioridad` restringida a valores permitidos.
- `fecha_limite` validada como fecha real.
- Rate limiting por IP (20 peticiones cada 5 minutos por defecto) para proteger el saldo de la API de IA.

---

## Evidencia de prueba

Herramienta usada: **curl** (equivalente en Postman/Swagger).

### Prueba exitosa

```bash
curl -X POST http://localhost:4321/api/v1/recommend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_API_KEY" \
  -d '{"titulo":"Estudiar para el examen de cálculo","prioridad":"alta","tipo_usuario":"estudiante"}'
```

Respuesta esperada: `200` con el campo `recomendacion`.

### Prueba de error controlado (falta el título)

```bash
curl -X POST http://localhost:4321/api/v1/recommend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_API_KEY" \
  -d '{"prioridad":"alta"}'
```

Respuesta esperada:

```json
{ "error": "El campo \"titulo\" es obligatorio y no puede estar vacío." }
```
(código HTTP `400`)

### Prueba de salud

```bash
curl http://localhost:4321/api/v1/health
```

---

## Cómo probar

1. Arranca el servidor: `npm run dev`
2. Ejecuta los comandos curl de arriba, o impórtalos en Postman.
3. Para capturas de evidencia, guarda la salida de cada comando (éxito + error).

> **Nota de seguridad:** ninguna clave se expone en las respuestas. `ZAI_API_KEY`
> es solo del servidor; `AI_API_KEY` se comparte únicamente con los clientes
> cerrados autorizados. Ambas viven fuera de Git.
