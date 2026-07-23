# API Inteligente — NovaTareas Pro

Documento de contratos de integración (Semana 2, Módulo 4).

La API expone la capacidad de IA del proyecto (recomendaciones de productividad) como un servicio consumible desde cualquier cliente externo (curl, Postman, Swagger, interfaz web). Es **independiente del dashboard**: no requiere sesión ni que la tarea exista previamente en la base de datos.

**URL base (desarrollo):** `http://localhost:4321`

---

## Endpoints

| Método | Ruta | Propósito |
|---|---|---|
| GET  | `/api/v1/health`    | Verificar que el servicio está activo. |
| GET  | `/api/v1/metadata`  | Informar versión, modelo, propósito y contrato. |
| POST | `/api/v1/recommend` | Ejecutar la capacidad inteligente principal. |

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
    "ollama_available": false,
    "fallback_rules": true
  }
}
```

> El estado es `ok` incluso si z.ai y Ollama están caídos, porque el servicio siempre puede responder con reglas locales como último recurso.

---

## 2. `GET /api/v1/metadata`

Devuelve información del servicio y el contrato de entrada/salida.

**Respuesta exitosa (200):** objeto con `version`, `primary_model`, `purpose`, `endpoints`, `input_contract` y `output_contract`.

---

## 3. `POST /api/v1/recommend`

Genera una recomendación de productividad para una tarea.

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
  -d '{"titulo":"Estudiar para el examen de cálculo","prioridad":"alta","tipo_usuario":"estudiante"}'
```

Respuesta esperada: `200` con el campo `recomendacion`.

### Prueba de error controlado (falta el título)

```bash
curl -X POST http://localhost:4321/api/v1/recommend \
  -H "Content-Type: application/json" \
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

> **Nota de seguridad:** ninguna clave (`ZAI_API_KEY`, etc.) se expone en las respuestas ni en este documento. Todas viven en el archivo `.env`, que no se versiona.
