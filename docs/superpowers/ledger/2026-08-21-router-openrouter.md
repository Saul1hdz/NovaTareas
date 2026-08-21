# Registro: router de proveedores remotos de IA (OpenRouter → z.ai)

**Fecha:** 2026-08-21
**Alcance:** el orden de los proveedores externos de texto y su trazabilidad.
Sin spec ni plan previos: el diseño se acordó en la conversación —OpenRouter
primero, z.ai como respaldo— antes de tocar código.

## Qué se buscaba

Probar `stealth/ox-alpha`, el modelo anónimo que OpenRouter publicó el
2026-08-20 gratis durante una semana, sin renunciar a z.ai si falla. La app
tenía cuatro copias del mismo `if (ZAI_API_KEY) { ... }` —motor de
recomendaciones, endpoint de la tarea, endpoint de comentarios y bot de
Telegram—, así que añadir un proveedor delante significaba tocar los cuatro y
que se desincronizaran a la primera.

## Qué quedó hecho

| Pieza | Estado |
|---|---|
| `callOpenRouter()` con el mismo contrato que `callZai()` | Hecho |
| `callRemote()`: OpenRouter → z.ai, devolviendo `{ text, source, model }` | Hecho |
| Los cuatro llamantes usan el router en vez de su copia | Hecho |
| `openrouter` en el enum `recommendation_source` (migración `0008`) | Hecho y aplicado en dev |
| `task_recommendations.model` guarda el modelo real, no uno deducido | Hecho |
| `/api/v1/health` publica `openrouter_configured` | Hecho |
| `/api/v1/metadata` anuncia el proveedor activo, no uno fijo | Hecho |
| `.env.example`, `release-manifest.yml` y `CHANGELOG.md` al día | Hecho |
| Siete pruebas del router en `tests/aiRouter.test.js` | Hechas, en verde |

## Decisiones

**Un `content` vacío cuenta como fallo, no como respuesta.** `stealth/ox-alpha`
es un modelo de razonamiento: si agota el presupuesto de tokens razonando,
devuelve un **200 con la respuesta en blanco**. Tratarlo como éxito habría
guardado recomendaciones vacías en `task_recommendations` sin que ningún error
lo delatara.

**Razonar no se puede desactivar, solo excluir.** La primera versión mandaba
`reasoning: { enabled: false }` para que el modelo no gastara tokens pensando.
El proveedor devuelve un **400**: «Reasoning is mandatory for this endpoint and
cannot be disabled». Lo que sí acepta es `exclude: true`, que le deja razonar
sin devolver esos tokens. Como se cobran del mismo presupuesto que la respuesta
—55 tokens para contestar «hola» en una frase—, el límite sube de 700 a 2100.

**El source nuevo es `openrouter`, no `oxalpha`.** El modelo se configura con
`OPENROUTER_MODEL`; el valor del enum identifica al proveedor, que es lo que no
cambia. El modelo concreto ya queda en la columna `model`.

**La clave vive solo en el `.env` local.** El proveedor `stealth` retiene
prompts y respuestas —dice que no entrena con ellos— y no publica quién está
detrás. En el portátil le llegan tareas de prueba; en producción le llegarían
las de usuarios reales, así que activarlo allí es una decisión aparte. Sin
`OPENROUTER_API_KEY` la cascada arranca en z.ai igual que antes.

**`OPENROUTER_URL` es configurable.** Nació de necesitar un doble local para la
prueba de extremo a extremo; de paso permite apuntar a un proxy propio.

## Cómo se verificó

Las cuatro puertas: `npm run lint` (0 errores), `npm run test` (**219 pruebas en
32 ficheros, todas en verde**) y `npm run build` (completo). No hay script
`typecheck` en este repo; `lint` es `astro check`, que ya hace la comprobación
de tipos.

Y la parte que no cubren los tests, contra la app corriendo con un doble local
de OpenRouter en el puerto 4599:

- `POST /api/v1/recommend` devolvió `"fuente": "openrouter"` con el texto del
  doble. El doble registró `modelo pedido: stealth/ox-alpha` y la cabecera
  `X-Title: NovaTareas`.
- `POST /api/tasks/1/ai` autenticado guardó la fila real:
  `source = openrouter`, `model = stealth/ox-alpha`. Es lo que prueba que la
  migración `0008` surtió efecto — sin ella el INSERT habría reventado contra el
  enum.
- Con el doble devolviendo 500 y sin z.ai ni Ollama configurados, la respuesta
  degradó a `"fuente": "rules"`. La cascada no se queda colgada en el proveedor
  caído.
- `SELECT enumlabel FROM pg_enum` confirma el orden
  `zai, openrouter, ollama, history, rules`.

## Contra el modelo real

Con `OPENROUTER_API_KEY` puesta en el `.env` local:

- `POST /api/tasks/2/ai` autenticado guardó `source = openrouter`,
  `model = stealth/ox-alpha`, 794 caracteres de recomendación.
- `/api/v1/health` publica `openrouter_configured: true` y `/api/v1/metadata`
  anuncia `stealth/ox-alpha` como primario.
- **Tiempos con prompt corto:** Ox Alpha **6,1–7,3 s**; `glm-4.5-flash` **3,4 s**.
- **Tiempos en el endpoint real del dashboard**, con RAG, historial y feedback
  dentro del prompt: Ox Alpha **22–26 s**; `glm-4.5-flash` **10,8 s**. El
  timeout del proveedor (45 s) le sobra, pero **el frontend aborta a los 50 s**,
  así que el margen se queda en la mitad del que había. Es el dato que más pesa
  en contra de ponerlo de primario en producción.
- **Calidad:** las dos respuestas son utilizables. La de Ox Alpha es más
  concreta —cita el trimestre anterior y pide dejar el borrador un día antes de
  la fecha límite—; la de z.ai es más corta y genérica. Una muestra de un solo
  prompt no decide nada: para afirmar que es mejor haría falta medir varios.

## Qué no se hizo

- **No se ha medido con más de un prompt.** La comparación de arriba es
  anecdótica, no una medición.
- **La clave no entra en producción.** El `.env` local es solo del portátil.
- **`src/lib/rag.js` no entra.** Los embeddings siguen yendo a z.ai y a Ollama
  por su cuenta; el router es solo de generación de texto.
- **El precio después del periodo gratis es desconocido** y la ventana cierra
  alrededor del 2026-08-27.

## Lo que encontró probar la interfaz, no la API

Dos fallos que ninguna llamada con `curl` habría enseñado:

**La tarjeta decía «Sugerencia» con Ox Alpha respondiendo.** El mapa
`RECOMMENDATION_SOURCES` de `dashboard.astro` traduce el origen a una etiqueta y
no conocía `openrouter`, así que caía al genérico —que es justo la etiqueta del
fallback de reglas locales—. La interfaz afirmaba que no había habido IA en el
momento exacto en que sí la hubo. Fijado con
`tests/recommendationSourceLabels.test.js`, que compara el enum de la base con
las claves del mapa: un proveedor nuevo sin etiqueta pone el test en rojo.

**`/api/v1/health` informaba `false` de claves que funcionaban.** Leía
`process.env` al cargar el módulo, y en dev ese módulo puede evaluarse antes de
que el entorno termine de poblarse desde `.env`; una constante congela ese
instante. Se veía con `zai_configured: false` mientras z.ai contestaba y
guardaba filas. Afectaba ya a `zai_configured` y `external_api_configured`
**antes de este trabajo**; la línea de `openrouter` heredó el defecto. Ahora las
lee dentro del handler.

## El fallo que solo apareció con una clave real

`vitest.config.js` vacía `ZAI_API_KEY` a propósito para que la suite no salga a
internet, y el proveedor nuevo no se añadió a esa lista. Mientras no hubo clave
de OpenRouter no se notó: las 218 pruebas pasaban. En cuanto se puso una real en
el `.env` del portátil, **quince pruebas empezaron a llamar a OpenRouter por
internet y fallaron**. Corregido con `OPENROUTER_API_KEY: ''` en el bloque `env`
y un comentario que dice que cada proveedor nuevo del router hay que añadirlo
también ahí.

Es el caso de libro de un verde que no probaba lo que decía: la suite no
verificaba el aislamiento, solo se beneficiaba de que la variable no existía.

## Hallazgo lateral, sin arreglar

Con la cascada degradada a reglas, una tarea de `tipo_usuario: empleado`
titulada «Preparar informe de prueba» devolvió la plantilla de estudio, con
emoji de libros y consejo de repasar temario. Es de `getRulesRecommendation` y
**es anterior a este cambio**: la heurística casa por palabras del título y se
salta el tipo de usuario. No se toca aquí para no mezclar temas.
