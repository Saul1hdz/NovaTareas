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
| Seis pruebas del router en `tests/aiRouter.test.js` | Hechas, en verde |

## Decisiones

**Un `content` vacío cuenta como fallo, no como respuesta.** `stealth/ox-alpha`
es un modelo de razonamiento: si agota el presupuesto de tokens razonando,
devuelve un **200 con la respuesta en blanco**. Tratarlo como éxito habría
guardado recomendaciones vacías en `task_recommendations` sin que ningún error
lo delatara. Por lo mismo va `reasoning: { enabled: false }` en la petición.

**El source nuevo es `openrouter`, no `oxalpha`.** El modelo se configura con
`OPENROUTER_MODEL`; el valor del enum identifica al proveedor, que es lo que no
cambia. El modelo concreto ya queda en la columna `model`.

**La clave se deja sin definir.** El proveedor `stealth` retiene prompts y
respuestas —dice que no entrena con ellos— y no publica quién está detrás. A ese
endpoint le llegan títulos y descripciones de tareas de usuarios reales. El
código está listo; activarlo es una decisión que se toma aparte, y sin
`OPENROUTER_API_KEY` la cascada arranca en z.ai igual que antes.

**`OPENROUTER_URL` es configurable.** Nació de necesitar un doble local para la
prueba de extremo a extremo; de paso permite apuntar a un proxy propio.

## Cómo se verificó

Las cuatro puertas: `npm run lint` (0 errores), `npm run test` (**218 pruebas en
32 ficheros, todas en verde**) y `npm run build` (completo). No hay script
`typecheck` en este repo; `lint` es `astro check`, que ya hace la comprobación
de tipos.

Y la parte que no cubren los tests, contra la app corriendo con un doble local
de OpenRouter en el puerto 4599:

- `POST /api/v1/recommend` devolvió `"fuente": "openrouter"` con el texto del
  doble. El doble registró `modelo pedido: stealth/ox-alpha`,
  `reasoning: {"enabled":false}` y la cabecera `X-Title: NovaTareas`.
- `POST /api/tasks/1/ai` autenticado guardó la fila real:
  `source = openrouter`, `model = stealth/ox-alpha`. Es lo que prueba que la
  migración `0008` surtió efecto — sin ella el INSERT habría reventado contra el
  enum.
- Con el doble devolviendo 500 y sin z.ai ni Ollama configurados, la respuesta
  degradó a `"fuente": "rules"`. La cascada no se queda colgada en el proveedor
  caído.
- `SELECT enumlabel FROM pg_enum` confirma el orden
  `zai, openrouter, ollama, history, rules`.

## Qué no se hizo

- **No se ha llamado al modelo de verdad.** No hay `OPENROUTER_API_KEY`, así que
  todo lo verificado usa un doble local. Cuánto tarda Ox Alpha, si el timeout de
  45 s le basta y si su texto es mejor que el de `glm-4.5-flash` sigue sin
  medirse.
- **`src/lib/rag.js` no entra.** Los embeddings siguen yendo a z.ai y a Ollama
  por su cuenta; el router es solo de generación de texto.
- **El precio después del periodo gratis es desconocido** y la ventana cierra
  alrededor del 2026-08-27.

## Hallazgo lateral, sin arreglar

Con la cascada degradada a reglas, una tarea de `tipo_usuario: empleado`
titulada «Preparar informe de prueba» devolvió la plantilla de estudio, con
emoji de libros y consejo de repasar temario. Es de `getRulesRecommendation` y
**es anterior a este cambio**: la heurística casa por palabras del título y se
salta el tipo de usuario. No se toca aquí para no mezclar temas.
