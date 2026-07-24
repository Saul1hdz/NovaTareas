# Mapa de pruebas — Semana 3

**Proyecto:** NovaTareas Pro
**Equipo:** Equipo 3 (Saúl López, Moises Martínez, Enson Carranza)
**Herramienta:** Vitest (equivalente a pytest en el ecosistema Node/Astro)

Este documento define **qué comportamientos del proyecto se prueban y por qué aportan valor**, antes de mostrar el código de las pruebas.

---

## Comportamiento crítico 1 — El servicio de IA está disponible

### ¿Por qué es crítico?

El dashboard web y el bot de Telegram dependen del mismo servicio de IA. Si el servicio deja de responder, el usuario no recibe recomendaciones por ningún canal. Además, el servicio tiene una cascada de fallback (z.ai → Ollama → reglas locales) cuyo propósito es que **siempre** haya respuesta; esta prueba verifica que esa promesa se cumple.

### Prueba exitosa

| Elemento | Detalle |
|---|---|
| **Qué se prueba** | `GET /api/v1/health` responde correctamente |
| **Datos de prueba** | Ninguno (petición sin cuerpo) |
| **Resultado esperado** | Código `200`, campo `status` igual a `"ok"`, campo `service` igual a `"novatareas-ai"` |
| **Archivo** | `tests/api.test.js` |

```js
it('responde 200 con status ok', async () => {
  const response = await healthGET();
  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.status).toBe('ok');
  expect(data.service).toBe('novatareas-ai');
});
```

### Prueba de contrato asociada

Además del estado, se verifica que el endpoint informe el estado de sus dependencias, porque de eso depende saber **por qué** el sistema está respondiendo con un motor u otro.

| Elemento | Detalle |
|---|---|
| **Qué se prueba** | El objeto `checks` reporta el estado de cada motor |
| **Resultado esperado** | `zai_configured` y `ollama_available` son booleanos; `fallback_rules` es siempre `true` |

---

## Comportamiento crítico 2 — El endpoint de IA respeta su contrato de entrada

### ¿Por qué es crítico?

`POST /api/v1/recommend` es la capacidad inteligente principal del proyecto y está pensada para consumo externo (curl, Postman, otras aplicaciones). Si acepta entradas inválidas:

- Se envían prompts basura al modelo, consumiendo saldo de la API sin generar valor.
- El cliente externo recibe errores confusos o respuestas sin sentido en lugar de un mensaje claro.

Por eso se prueban **ambos lados del contrato**: que funcione con datos válidos y que rechace correctamente los inválidos.

### Prueba exitosa

| Elemento | Detalle |
|---|---|
| **Qué se prueba** | `POST /api/v1/recommend` con un payload válido |
| **Datos de prueba** | `{"titulo": "Estudiar para el examen de cálculo", "prioridad": "alta", "tipo_usuario": "estudiante"}` |
| **Resultado esperado** | Código `200`, campo `recomendacion` presente y de tipo texto no vacío, campo `fuente` con uno de los valores `zai`, `ollama` o `rules` |
| **Archivo** | `tests/api.test.js` |

```js
it('responde 200 y devuelve una recomendación', async () => {
  const response = await recommendPOST(
    makeContext({ titulo: 'Estudiar para el examen de cálculo', prioridad: 'alta', tipo_usuario: 'estudiante' })
  );

  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.recomendacion).toBeDefined();
  expect(data.recomendacion.length).toBeGreaterThan(0);
});
```

### Prueba de error controlado

| Elemento | Detalle |
|---|---|
| **Qué se prueba** | `POST /api/v1/recommend` sin el campo obligatorio `titulo` |
| **Datos de prueba** | `{"prioridad": "alta"}` |
| **Resultado esperado** | Código `400`, campo `error` con un mensaje comprensible que menciona el campo faltante |
| **Archivo** | `tests/api.test.js` |

```js
it('responde 400 cuando falta el título', async () => {
  const response = await recommendPOST(makeContext({ prioridad: 'alta' }));

  expect(response.status).toBe(400);
  const data = await response.json();
  expect(data.error).toMatch(/titulo/i);
});
```

---

## Cobertura completa implementada

El mapa inicial se amplió hasta **80 pruebas** para cubrir el contrato y los
flujos críticos del producto.

| Archivo | Pruebas | Comportamiento cubierto |
|---|---|---|
| `tests/aiEngine.test.js` | 14 | Validación de entrada: títulos vacíos o muy largos, descripciones fuera de límite, prioridades no permitidas, fechas mal formadas, cuerpos que no son objetos |
| `tests/api.test.js` | 13 | Salud del servicio, contrato de metadatos, autenticación, respuestas exitosas y errores controlados |
| `tests/appFlows.test.js` | 14 | Autenticación, tareas, ownership, subtareas, historial y comentarios |
| `tests/security.test.js` | 6 | Sesiones, límites, secretos y OAuth `state` |
| `tests/migrations.test.js` | 2 | Esquema SQLite idempotente y rechazo de bases heredadas |
| `tests/taskValidation.test.js` | 3 | Validación de tareas y comentarios |
| `tests/integrationSecurity.test.js` | 8 | Cron, Telegram y avatares |
| `tests/postgresSchema.test.js` | 7 | Migraciones y restricciones PostgreSQL con PGlite |
| `tests/tokenEncryption.test.js` | 3 | Protección de tokens persistidos |
| `tests/reminders.test.js` | 3 | Zona horaria, idempotencia y fallos de entrega |
| `tests/aiProviders.test.js` | 3 | z.ai, Ollama y reglas locales |
| `tests/googleIntegration.test.js` | 4 | OAuth, eventos y renovación de tokens |

### Datos de prueba utilizados

Todos los datos son **simples y ficticios**, sin información personal ni credenciales:

| Caso | Dato |
|---|---|
| Tarea académica válida | `"Estudiar para el examen de cálculo"` |
| Tarea laboral válida | `"Preparar reunión de equipo"` |
| Tarea cotidiana simple | `"Comprar pan"` (prioridad baja) |
| Título vacío | `""` y `"     "` |
| Título excesivo | 201 caracteres repetidos |
| Prioridad inválida | `"altisima"` |
| Fecha inválida | `"no-es-fecha"` |
| JSON malformado | `"{ esto no es json"` |

---

## Decisión técnica: pruebas sin dependencias externas

Las pruebas **no llaman a servicios externos reales**. z.ai, Ollama, Telegram y
Google se simulan; los casos offline fuerzan las reglas locales.

El workflow de CI aprovecha esto y **no define esa variable** en el paso de pruebas, con tres beneficios:

1. Las pruebas son deterministas: siempre el mismo resultado.
2. No consumen saldo de la API en cada push.
3. No fallan por problemas de red o cuota agotada.

> **Nota:** durante la implementación se detectó que un intento anterior de simular la ausencia de la clave con `vi.stubEnv()` no funcionaba, porque el módulo lee la variable al cargarse. El detalle está documentado en [`docs/registro-pruebas-semana-3.md`](registro-pruebas-semana-3.md), sección 2.9.

---

## Cómo ejecutar

```bash
npm ci        # instala exactamente el lockfile
npm test      # ejecuta las 80 pruebas
npm run lint          # verificar tipos y sintaxis del proyecto
```

Resultado esperado: 80 pruebas superadas, sin conexión a servicios externos ni
credenciales reales.
