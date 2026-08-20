# Documentación de NovaTareas Pro

Índice de esta carpeta. Está dividido en dos: lo que describe el proyecto **tal
como está hoy** y lo que son **actas históricas**. La distinción importa, porque
los documentos históricos contienen comandos que ya no existen.

El punto de partida sigue siendo el [README del proyecto](../README.md).

---

## Vigente

### Entender el sistema

| Documento | Qué encontrarás |
|---|---|
| [`ARQUITECTURA.md`](ARQUITECTURA.md) | Capas, puertas de entrada, cascada de IA, procesos desplegados y cuándo tocaría partir el monolito |
| [`POSTGRESQL_DISENO_BLOQUE_2.md`](POSTGRESQL_DISENO_BLOQUE_2.md) | Diseño del esquema, diccionario de datos y límites |
| [`MODO_COLABORATIVO.md`](MODO_COLABORATIVO.md) | Niveles de acceso, invitaciones por enlace y endpoints del trabajo en equipo |
| [`../api.md`](../api.md) | Contratos completos de la API inteligente |

### Operar y verificar

| Documento | Qué encontrarás |
|---|---|
| [`DESPLIEGUE.md`](DESPLIEGUE.md) | Runbook del servidor: variables, proxy inverso, respaldos, actualización, vuelta atrás y comprobación posterior |
| [`SEGURIDAD.md`](SEGURIDAD.md) | Qué se protege, con qué control, qué prueba lo respalda y qué queda fuera del alcance |
| [`OBSERVABILIDAD_SEMANA_5.md`](OBSERVABILIDAD_SEMANA_5.md) | Instrumentación, línea base de rendimiento, cuello de botella y plan de escalabilidad |
| [`ENTORNO_WINDOWS.md`](ENTORNO_WINDOWS.md) | Docker Desktop en Windows: los tropiezos típicos y cómo evitarlos |

### Pruebas

| Documento | Qué encontrarás |
|---|---|
| [`pruebas-semana-3.md`](pruebas-semana-3.md) | Mapa de pruebas: qué valida cada una, por qué aporta y con qué datos |
| [`registro-pruebas-semana-3.md`](registro-pruebas-semana-3.md) | Errores detectados, correcciones aplicadas y bloqueos abiertos |

### Trabajo pendiente

| Documento | Qué encontrarás |
|---|---|
| [`TODO_DESARROLLO.md`](TODO_DESARROLLO.md) | Backlog por bloques, con lo hecho y lo pendiente |

---

## Evidencias de demostración

| Evidencia | Contenido |
|---|---|
| [`Evidencia_Semana3.pdf`](Evidencia_Semana3.pdf) | Entrega de la semana 3 |
| [`Semana5_Observabilidad_Rendimiento_NovaTareas.pdf`](Semana5_Observabilidad_Rendimiento_NovaTareas.pdf) | Entrega de la semana 5 |
| [`mediciones/`](mediciones/) | 13 archivos JSON con las mediciones reales de rendimiento: percentiles, tasa de error y muestras crudas |
| [`QA_IA_LOCAL.md`](QA_IA_LOCAL.md) | Prueba real contra z.ai, hallazgos de calidad y correcciones del RAG |
| [`QA_TELEGRAM_LOCAL.md`](QA_TELEGRAM_LOCAL.md) | QA del bot con usuarios ficticios |
| [`QA_ESTABILIZACION_LOCAL.md`](QA_ESTABILIZACION_LOCAL.md) | Estabilización del entorno local |

---

## Histórico

> Estos documentos describen cómo estaba el proyecto **al cerrar cada etapa**.
> Sirven para entender por qué se tomó una decisión, no para seguir sus
> instrucciones: varios mencionan SQLite, comandos retirados o rutas que ya no
> existen. **Cuando haya discrepancia, mandan el código, las migraciones y el
> README.**

| Documento | Momento que retrata |
|---|---|
| [`LINEA_BASE_BLOQUE_0.md`](LINEA_BASE_BLOQUE_0.md) | Estado del proyecto antes de empezar |
| [`CIERRE_BLOQUE_1.md`](CIERRE_BLOQUE_1.md) | Seguridad crítica: dependencias, credenciales de IA y controles cerrados |
| [`CIERRE_BLOQUE_2.md`](CIERRE_BLOQUE_2.md) | Esquema reproducible y decisión de PostgreSQL |
| [`CIERRE_BLOQUE_3.md`](CIERRE_BLOQUE_3.md) | Suite de pruebas y puesta en marcha del CI |
| [`BLOQUE_4_LINEA_BASE.md`](BLOQUE_4_LINEA_BASE.md) | Medición previa a la migración de SQLite a PostgreSQL |
| [`CIERRE_BLOQUE_4.md`](CIERRE_BLOQUE_4.md) | PostgreSQL y Docker en local |
| [`CIERRE_MIGRACION_POSTGRESQL.md`](CIERRE_MIGRACION_POSTGRESQL.md) | Cómo se retiró SQLite por completo y qué implicó |
