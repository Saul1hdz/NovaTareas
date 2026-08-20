# Verificación de las guardias del pipeline

**Fecha:** 2026-08-20

Una guardia que nunca se ha visto fallar no se sabe si está encendida. Un
`continue-on-error` mal puesto o un filtro demasiado ancho la dejan pasando en
verde para siempre sin que nadie lo note. Este documento registra la prueba de
que cada una salta cuando debe.

Tres de las cuatro no hizo falta provocarlas: saltaron solas durante la
implementación, que es una evidencia más fuerte que un simulacro.

## Resultado

| Guardia | Qué la hizo fallar | Qué pasó | Evidencia |
|---|---|---|---|
| Gitleaks | No se provocó: saltó sola | Detectó `TOKEN_ENCRYPTION_KEY` en el fichero del plan y marcó el trabajo con `🛑 Leaks detected` | [run 32390026877](https://github.com/Saul1hdz/NovaTareas/actions/runs/32390026877) |
| Trivy | No se provocó: saltó solo | 8 vulnerabilidades con parche (7 HIGH + 1 CRITICAL) en el CLI de npm de la imagen base. **Detuvo el trabajo antes de publicar** | [run 32391032016](https://github.com/Saul1hdz/NovaTareas/actions/runs/32391032016) |
| `npm audit` | Provocada: se añadió `lodash@4.17.15` | `1 high severity vulnerability` y **código de salida 1** | Ejecución local, ver abajo |
| Publicación solo desde `main` | Push a la rama `develop` | Todo lo anterior en `success` y los tres pasos de publicación en `skipped` | [run 32391935973](https://github.com/Saul1hdz/NovaTareas/actions/runs/32391935973) |

## Detalle de cada una

### Gitleaks

Saltó en la primera ejecución tras instalarse. El hallazgo resultó ser un falso
positivo —la clave de pruebas `MDEyMzQ1…`, que decodifica a
`0123456789abcdef0123456789abcdef` y ya vivía en `vitest.config.js` desde
julio—, pero **el falso positivo demuestra que la guardia funciona**: detectó
por entropía una cadena que parecía una credencial.

Se resolvió con `.gitleaks.toml` y una lista de excepciones acotada a ese valor
exacto, al sufijo `-solo-para-pruebas`, a `.env.example` y a `docs/superpowers/`.
No se desactivó la regla `generic-api-key`: silenciarla entera dejaría pasar la
siguiente clave, que sí podría ser real.

Un escaneo del historial completo reveló además cinco hallazgos históricos, el
más relevante un `SECRET_KEY` por defecto incrustado en `src/lib/auth.js` hasta
el 11 de julio. El operador del servidor verificó que la clave de producción no
coincide con aquel valor, comparando huellas SHA-256 del valor efectivo dentro
del contenedor en ejecución. No hubo que rotar nada.

### Trivy

Detuvo el trabajo `Imagen de produccion` **antes** del paso de publicación, que
es donde está colocado a propósito: una imagen vulnerable falla y nunca llega al
registro.

Las 8 vulnerabilidades no estaban en el código del proyecto —las 383
dependencias de `/app` y la capa de Debian salían a cero— sino en el CLI de npm
que trae `node:22.23.1-bookworm-slim`, incluida la gzip bomb `CVE-2026-59873` de
`tar`, clasificada como CRITICAL.

Actualizar Node no las corregía: `22.23.2`, la última de la línea, trae el mismo
`npm 10.9.8`, y saltar a Node 26 lo impide `engines: >=22.12.0 <23.0.0`. Se
resolvió eliminando npm, npx y corepack de la etapa `runtime` del Dockerfile: el
contenedor solo ejecuta `node`, y las dependencias se instalan antes. Tras el
cambio, Trivy pasa a cero.

### `npm audit`

Única que hubo que provocar, porque el proyecto está limpio. Se añadió
`lodash@4.17.15` al árbol de dependencias:

```
$ npm install lodash@4.17.15 --package-lock-only --save
$ npm audit --audit-level=high
...
Prototype Pollution in lodash - GHSA-p6mc-m468-83gw
Regular Expression Denial of Service (ReDoS) in lodash - GHSA-29mw-wpgm-hmr9
lodash vulnerable to Code Injection via `_.template` - GHSA-r5fr-rjxr-66jc
...
1 high severity vulnerability
CODIGO DE SALIDA: 1
```

El cambio se revirtió inmediatamente y el proyecto vuelve a `found 0
vulnerabilities`. La comprobación se hizo en local porque el paso del workflow
ejecuta exactamente el mismo comando y su resultado es determinista: un código
de salida distinto de cero hace fallar el trabajo.

Dos mutaciones previas **no** sirvieron y merecen quedar registradas, porque
ilustran cómo una prueba puede parecer concluyente sin serlo:

- `npm pkg set overrides.minimist=0.0.8` no cambió nada: `minimist` no está en
  el árbol de dependencias, así que el override no aplicaba a ningún paquete.
- Quitar el override de `brace-expansion` tampoco: npm resuelve hoy por su
  cuenta una versión que ya no es vulnerable. Ese override es deuda que se puede
  retirar.

Si cualquiera de las dos se hubiera dado por buena al ver «0 vulnerabilidades»,
la conclusión habría sido la contraria a la correcta.

### Publicación condicionada a `main`

Se empujó el trabajo completo a la rama `develop`. El trabajo `Imagen de
produccion` construyó la imagen, aplicó las migraciones con ella, la arrancó
contra PostgreSQL y la escaneó — todo en `success` — y los tres pasos de
publicación (`Calcular las etiquetas`, `Entrar en GHCR`, `Publicar la imagen`)
aparecieron como `skipped`.

El matiz importa: una ejecución **fallida** en rama también los habría dejado
como `skipped`, sin demostrar nada sobre el condicional. La evidencia solo vale
con todo lo anterior en verde.

## Lo que estas pruebas no cubren

- CodeQL no se ha provocado. Publica análisis (87 reglas, 0 resultados) pero no
  se ha comprobado que detecte una vulnerabilidad introducida a propósito.
- El umbral de cobertura no existe: el informe se sube como artefacto
  informativo y nada falla si baja.
