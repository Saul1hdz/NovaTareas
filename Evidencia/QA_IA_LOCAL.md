# QA local de IA externa

Fecha: 24 de julio de 2026

## Alcance

Se probó la integración real de z.ai desde el motor y desde el botón `Consejos`
del dashboard, usando una cuenta ficticia y una tarea universitaria ficticia.
La clave permaneció únicamente en `.env`, ignorado por Git.

No se utilizó Netcup ni se incorporaron secretos al repositorio o a CI.

## Selección de modelo

| Modelo | Resultado observado |
|---|---|
| `glm-4.7-flash` | Dos respuestas `429 / 1305` por saturación temporal |
| `glm-4.5-flash` | Respuesta `200`; integración funcional |

Se mantiene `glm-4.5-flash` para el desarrollo local por disponibilidad. Los
valores predeterminados de web, bot y comentarios quedaron alineados para evitar
caer accidentalmente en `glm-5.2` si falta `ZAI_MODEL`.

## Hallazgo de calidad

La primera recomendación del dashboard inventó antecedentes del usuario y
desvió el contenido hacia un tema no solicitado. La causa fue doble:

1. El RAG aceptaba tareas archivadas aunque no tuvieran `what_worked`,
   `what_failed` ni `observations`.
2. El prompt obligaba al modelo a citar historial y mencionar patrones
   negativos, aunque la coincidencia fuera ambigua.

## Corrección

- El historial semántico solo admite tareas con al menos un aprendizaje
  explícitamente registrado.
- El prompt trata el historial como evidencia opcional y no confiable.
- Se prohíbe inventar materias, recursos, horarios, conductas pasadas o detalles
  ausentes.
- El historial se menciona únicamente cuando aporta evidencia directa y útil.
- Se añadieron pruebas unitarias del contrato del prompt.

## Resultado posterior

La misma tarea produjo una recomendación centrada en:

- dividir una exposición de diez minutos en introducción, desarrollo y cierre;
- asignar tiempo a cada sección;
- realizar ensayos completos;
- priorizar fluidez sobre memorización.

No inventó historial, recursos ni hábitos del usuario. El dashboard no registró
errores o advertencias de consola durante el flujo.

## Límites pendientes

- La latencia real observada puede superar diez segundos.
- El fallback entre modelos de z.ai todavía no es automático.
- RAG necesita una evaluación mayor con historial ficticio relevante,
  irrelevante y contradictorio.
- Falta mostrar en la interfaz si la respuesta vino de z.ai, Ollama, historial o
  reglas locales.
