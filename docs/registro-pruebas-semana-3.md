# Registro de pruebas, errores y correcciones — Semana 3

**Proyecto:** NovaTareas Pro
**Equipo:** Equipo 3 (Saúl López, Moises Martínez, Enson Carranza)

Este documento registra los errores detectados durante el desarrollo y la incorporación de pruebas automatizadas, las correcciones aplicadas y los bloqueos técnicos que siguen abiertos.

---

## 1. Estrategia de pruebas

Se utilizó **Vitest** por su compatibilidad nativa con módulos ESM y con el ecosistema de Astro, que es el framework del proyecto.

Las pruebas siguen el mismo principio que el `TestClient` de FastAPI visto en clase: en lugar de levantar el servidor y lanzar peticiones manuales con curl, se importa directamente el handler del endpoint y se le pasa un objeto `Request`. Esto hace que las pruebas sean rápidas, repetibles y no necesiten un puerto abierto ni intervención humana.

| Archivo | Pruebas | Qué valida |
|---|---|---|
| `tests/aiEngine.test.js` | 14 | Capa de validación de datos de entrada |
| `tests/api.test.js` | 11 | Endpoints `/health`, `/metadata` y `/recommend` |

**Total: 25 pruebas.**

### Decisión clave: pruebas sin dependencias externas

Las pruebas **no llaman a la API de IA real**. El motor (`aiEngine.js`) tiene una cascada de fallback (z.ai → Ollama → reglas locales), por lo que si la variable `ZAI_API_KEY` no está definida, el sistema responde con reglas locales de forma determinista.

Esto se aprovechó deliberadamente: el workflow de CI **no expone `ZAI_API_KEY`**, con tres beneficios:

1. Las pruebas son deterministas (siempre el mismo resultado).
2. No consumen saldo de la API en cada push.
3. No fallan por problemas de red o cuota agotada.

---

## 2. Errores detectados y corregidos

### 2.1. Error 429 — saldo insuficiente en la API de IA

**Síntoma:**
```
[Z.AI] Error: 429 {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}
POST /api/tasks/48/ai 25344ms
```

**Diagnóstico:** el código usaba el modelo `glm-5.2`, que requiere saldo de pago. Otro proyecto del equipo usaba la misma clave de API sin problemas porque apuntaba a `glm-4.5-flash`, que sí está incluido en el plan gratuito.

**Corrección:** se definió `ZAI_MODEL=glm-4.5-flash` en el archivo `.env` y se documentó la variable en `.env.example`.

---

### 2.2. Respuestas de 25 a 50 segundos

**Síntoma:** cuando la llamada a la IA fallaba, la respuesta tardaba hasta 50 segundos en llegar.

**Diagnóstico:** al fallar el modelo principal, el sistema intentaba el fallback local de Ollama. Como Ollama no estaba instalado, cada intento esperaba el timeout completo (10 s para embeddings + 20 s para generación) antes de rendirse.

**Corrección:** se añadió la función `isOllamaUp()`, que hace una comprobación rápida de 1,5 segundos antes de intentar generar. Si Ollama no responde, se salta directamente a las reglas locales.

**Resultado:** el peor caso pasó de ~50 s a ~2 s.

---

### 2.3. Recomendaciones cortadas a media frase

**Síntoma:** las recomendaciones terminaban abruptamente, por ejemplo: *"...Recuerda el error de"*.

**Diagnóstico:** doble causa.
1. El parámetro `max_tokens: 400` cortaba la respuesta por límite duro. En español cada palabra consume más de un token, por lo que el límite se alcanzaba antes de lo esperado.
2. El modelo generaba una sola oración muy larga encadenada con comas, sin puntos, lo que impedía cualquier recorte limpio.

**Corrección:**
- Se subió `max_tokens` a 700.
- Se añadió la función `trimToCompleteSentence()`, que recorta hasta el último punto completo, con la coma como último recurso.
- Se modificó el prompt para exigir explícitamente oraciones cortas separadas por punto.

---

### 2.4. Recomendaciones forzadas a citar el historial

**Síntoma:** en tareas triviales como *"comprar leche"*, la IA generaba comparaciones artificiales con el historial del usuario.

**Diagnóstico:** el prompt incluía la instrucción obligatoria *"Si hay historial, referenciarlo explícitamente"*.

**Corrección:** se reescribió el prompt para que el historial sea una herramienta **opcional**, y se añadió detección de tareas simples (prioridad baja + descripción corta) que solicitan una respuesta de 1 a 2 oraciones en lugar de 4 a 6.

---

### 2.5. Clave de API expuesta en los logs

**Síntoma:** el archivo `ai.js` contenía código de depuración que imprimía la clave de API en la consola del servidor:

```js
console.log("process.env:", process.env.GEMINI_API_KEY);
```

**Riesgo:** cualquier persona con acceso a los logs del servidor podría leer la credencial.

**Corrección:** se eliminaron todas las sentencias de depuración que exponían variables sensibles.

---

### 2.6. Credenciales reales en `.env.example`

**Síntoma:** el archivo `.env.example`, que sí se versiona en el repositorio, contenía claves reales de la API de IA y el token del bot de Telegram en lugar de valores de ejemplo.

**Riesgo:** exposición pública de credenciales al subir el repositorio.

**Corrección:**
- Se reemplazaron todos los valores por placeholders descriptivos.
- Se rotaron las credenciales afectadas.
- Se verificó que `.env` sí está en `.gitignore` y que **no** está rastreado por git.

---

### 2.7. `.env.example` excluido por error del repositorio

**Síntoma:** el archivo `.gitignore` incluía la línea `.env.example`.

**Diagnóstico:** el archivo de ejemplo **debe** versionarse, ya que es la plantilla que documenta las variables necesarias. Lo que debe ignorarse es únicamente `.env`.

**Corrección:** se eliminó esa línea del `.gitignore`.

---

### 2.8. Enlaces rotos en el README

**Síntoma:** el `README.md` enlazaba a cinco documentos de la carpeta `docs/`, pero la carpeta estaba vacía y `api.md` se encontraba en la raíz del proyecto.

**Corrección:** se movieron los documentos a `docs/` y se verificaron los enlaces.

---

### 2.9. Error detectado en las propias pruebas

**Síntoma:** una prueba intentaba simular la ausencia de la clave de API con `vi.stubEnv('ZAI_API_KEY', '')`, pero no tenía efecto.

**Diagnóstico:** `aiEngine.js` lee la variable en una constante **al cargar el módulo**, antes de que la prueba pueda modificarla. La prueba parecía funcionar solo porque en el entorno local la variable tampoco estaba definida. En un entorno de CI con el secreto configurado, la prueba habría llamado a la API real.

**Corrección:** se eliminó el stub inefectivo y se adoptó una estrategia explícita: el workflow de CI no define `ZAI_API_KEY` en el paso de pruebas. La decisión quedó documentada como comentario en el propio archivo de pruebas.

---

### 2.10. Dependencia sin usar

**Síntoma:** `package.json` declaraba `@google/genai` como dependencia.

**Diagnóstico:** quedó de cuando el proyecto usaba Google Gemini a través del SDK. Tras migrar a z.ai mediante llamadas HTTP directas, ningún archivo la importa.

**Corrección:** se eliminó de `package.json`.

---

## 3. Bloqueos técnicos abiertos

| Bloqueo | Descripción | Plan |
|---|---|---|
| Migraciones sin runner | Existen archivos con numeración duplicada (`002_*` y `003_*`) y deben ejecutarse manualmente en un orden específico. Se mitigó con el script `npm run migrate`, pero no hay control de versión de esquema. | Semana 4 |
| Pruebas sin base de datos | Las pruebas actuales cubren la validación y los endpoints de IA, que no dependen de SQLite. Los endpoints de tareas (`/api/tasks`) sí requieren base de datos y aún no tienen pruebas. | Semana 4 |
| Rate limiting en memoria | El límite de peticiones se reinicia con el servidor y no funcionaría con varias instancias desplegadas. | Semana 6 |
| Sin despliegue | GitHub Actions ejecuta las pruebas, pero el proyecto todavía no está desplegado en una URL pública. El adaptador de Node y el uso de SQLite con escrituras impiden usar hosting estático. | Semana 6 |

---

## 4. Cómo reproducir las pruebas

```bash
npm install     # instala dependencias, incluida Vitest
npm test        # ejecuta las 25 pruebas
```

Resultado esperado: 25 pruebas superadas, sin necesidad de conexión a internet ni de credenciales.
