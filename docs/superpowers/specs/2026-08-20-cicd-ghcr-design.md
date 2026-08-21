# Diseño: CI/CD con publicación en GHCR y seguridad automatizada

**Fecha:** 2026-08-20
**Estado:** aprobado, pendiente de plan de implementación
**Repositorio:** `Saul1hdz/NovaTareas` (público)

---

## 1. Punto de partida

El proyecto tiene CI, no CD.

`.github/workflows/ci.yml` corre en cada push a `main`, `master`, `develop` y
`testing`, y en pull requests a `main` y `master`. Un solo trabajo levanta un
PostgreSQL 16 efímero, aplica migraciones, verifica el esquema, ejecuta la
suite con cobertura, compila, construye la imagen `runtime` y comprueba que
responde en `/api/v1/health/ready`. Los últimos diez runs están en verde y
tardan unos dos minutos.

Lo que no existe:

- La imagen construida se descarta al terminar el job. No se publica en ningún
  registro.
- El despliegue lo hace Argus, el agente que administra el VPS Netcup: analiza
  el commit y levanta producción reconstruyendo desde el código.
- No hay auditoría de dependencias, escaneo de imagen, escaneo de secretos ni
  análisis estático.
- El workflow no declara `permissions`, `concurrency` ni `timeout-minutes`, y
  usa acciones en `v4`, ya deprecadas (las vigentes son `v7`).

**El problema de fondo:** lo que corre en producción no es el artefacto que
pasó las pruebas, sino una reconstrucción de él hecha en otro momento y en otra
máquina.

## 2. Objetivo

Que el artefacto validado por CI sea exactamente el que se despliega, y que el
pipeline compruebe la seguridad de la cadena de suministro antes de publicarlo.

**Fuera de alcance:** desplegar automáticamente en el VPS. Ver sección 6.

## 3. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Alcance del automatismo | Push a `main` publica la imagen; el VPS no se toca solo | Argus sigue siendo la salvaguarda ante migraciones destructivas |
| Estructura | Un solo workflow con tres trabajos | Evita construir la imagen dos veces por commit |
| Etiquetado | `sha-<corto>` + versión + `latest` | El SHA identifica sin ambigüedad; la versión es citable; `latest` sigue a `main` |
| Visibilidad del paquete | Público | El repo ya es público y la imagen no lleva secretos; evita guardar un token de registro en un VPS compartido |
| Seguridad | Paquete completo: dependencias, imagen, secretos, análisis estático, Dependabot | Repo público: los logs y el código son visibles para cualquiera |
| Despliegue | Lo sigue haciendo Argus, con `pull` en vez de `build` | Conserva la revisión humana del commit |

## 4. Arquitectura del pipeline

Un fichero, `.github/workflows/ci.yml`, con tres trabajos.

```
push a main / PR
        │
   ┌────┴──────────────────────────────────────────┐
   │ 1. calidad        (toda rama)                 │
   │    npm ci · lint · migrar PG · check PG       │
   │    tests con cobertura · build                │
   └────┬──────────────────────────────────────────┘
        │ verde
   ┌────┴──────────────────────────────────────────┐
   │ 2. imagen         (toda rama; publica en main)│
   │    docker build runtime → smoke /health/ready │
   │    → Trivy → push a GHCR [solo main]          │
   └────┬──────────────────────────────────────────┘
        │
   ┌────┴──────────────────────────────────────────┐
   │ 3. seguridad      (en paralelo con 1 y 2)     │
   │    npm audit · Gitleaks · CodeQL              │
   └───────────────────────────────────────────────┘
```

**Trabajo 1 — calidad.** Es el job actual, sin cambios en los pasos: `npm ci`,
`npm run lint`, `db:pg:migrate`, `db:pg:check`, `test:coverage`, subida del
artefacto de cobertura y `npm run build`. Mantiene el servicio PostgreSQL 16
efímero y las variables de entorno ficticias.

**Trabajo 2 — imagen.** Depende del anterior. Construye el target `runtime`,
**aplica las migraciones ejecutándolas desde la propia imagen**, arranca el
contenedor y espera respuesta de `/api/v1/health/ready`, pasa Trivy sobre esa
misma imagen y, **solo si la rama es `main`**, la publica en GHCR.

Migrar desde dentro de la imagen es una mejora sobre el pipeline actual, que
migra con el Node del runner: así nunca se comprobaba que la imagen publicada
supiera migrar por su cuenta, que es exactamente lo que hace el servicio
`migrate` de `compose.prod.yml` en producción. En cualquier otra rama hace todo menos publicar: así un PR
informa de si la imagen sigue siendo desplegable sin ensuciar el registro.

Construir una única vez es el motivo de que esto no sea un workflow aparte. Con
dos workflows, la imagen probada y la publicada serían dos construcciones
distintas y nada garantizaría que coinciden.

**Trabajo 3 — seguridad.** No depende de los otros dos, así que corre en
paralelo y no alarga el reloj.

### Endurecimiento del workflow

- `permissions` mínimos por trabajo: `contents: read` en general; únicamente el
  trabajo de imagen recibe `packages: write`, y el de seguridad
  `security-events: write` para publicar los hallazgos de CodeQL.
- `concurrency` por rama con `cancel-in-progress`: dos pushes seguidos cancelan
  la ejecución anterior en vez de correr a la vez.
- `timeout-minutes` en cada trabajo. Sin él, el bucle de `curl` del smoke podría
  colgarse hasta el límite por defecto de 360 minutos.
- Acciones a `actions/checkout@v7.0.1`, `actions/setup-node@v7.0.0`,
  `actions/upload-artifact@v7.0.1`. Las `v4` actuales apuntan a Node 20,
  deprecado y forzado a Node 24 por el runner.
- Borrar `vitest.frontend.config.js`: ningún script lo invoca y los cinco tests
  que lista ya entran por el `include` de `vitest.config.js`. No se pierde
  cobertura; se quita la falsa impresión de que existe una suite aparte.

### Etiquetado

Imagen: `ghcr.io/saul1hdz/novatareas`.

| Etiqueta | Cuándo | Para qué |
|---|---|---|
| `sha-<7 caracteres>` | Cada push a `main` | Identifica sin ambigüedad qué código corre. Es la que usa Argus para desplegar |
| `<versión>` (p. ej. `1.0.0`) | Cuando cambie la versión de `release-manifest.yml` | Nombre legible, alineado con el CHANGELOG |
| `latest` | Cada push a `main` | Último estado de `main` |

## 5. Seguridad

Cuatro guardias. Cada una detecta algo que las demás no ven.

**`npm audit --audit-level=high`** — vulnerabilidades en las dependencias de
npm. Hoy el proyecto sale con 0 vulnerabilidades, así que la puerta entra en
verde sin deuda heredada. El umbral es `high` y no `moderate` deliberadamente:
una puerta que salta cada semana por algo que no afecta acaba desactivada, y una
puerta desactivada no protege.

**Trivy (`aquasecurity/trivy-action@v0.36.0`)** — vulnerabilidades del sistema
operativo dentro del contenedor: los paquetes de `node:22.23.1-bookworm-slim` y
el `tini` instalado. Se ejecuta **antes del push al registro**, de modo que una
imagen vulnerable falla y nunca llega a publicarse. Filtra `HIGH,CRITICAL` e
ignora las vulnerabilidades sin parche disponible; bloquear por un CVE que nadie
ha arreglado todavía detiene el trabajo sin ofrecer una acción posible.

**Gitleaks (`gitleaks/gitleaks-action@v3.0.0`)** — secretos en el historial:
claves de z.ai, tokens de Telegram, credenciales de Google. Desde la v2 la
licencia dejó de ser MIT, pero solo las cuentas de organización necesitan clave;
`Saul1hdz` es de tipo `User`, así que no hace falta ninguna licencia ni secreto
adicional. En un repo público esta es la guardia más valiosa: un token filtrado
queda expuesto en el instante del push.

**CodeQL (`github/codeql-action`, bundle `codeql-bundle-v2.26.3`)** — análisis
estático con el paquete `javascript-typescript`: inyección, XSS, manejo inseguro
de rutas. Gratuito en repos públicos. Los hallazgos aparecen en la pestaña
Security del repositorio.

**Dependabot** (`.github/dependabot.yml`), semanal, sobre tres ecosistemas:
`npm`, `github-actions` (para no volver a acumular acciones deprecadas sin
enterarse) y `docker` (imagen base de Node). Abre pull requests; no integra
nada por su cuenta.

Estas comprobaciones son de cadena de suministro y complementan —no sustituyen—
la seguridad de aplicación ya existente, cubierta por `docs/SEGURIDAD.md` y por
los seis ficheros de tests de seguridad de `tests/` (CSRF, autorización,
cifrado de tokens, límites de registro).

## 6. Contrato con Argus

Argus administra el VPS Netcup, donde NovaTareas **convive con otros
servicios**. Hoy analiza el commit y despliega producción; ese papel se
conserva, porque es la revisión humana que evita que una migración destructiva
se aplique sin que nadie mire. `release-manifest.yml` ya lo advierte: volver el
código no revierte el esquema.

### Cambio en `compose.prod.yml`

Los tres servicios (`migrate`, `web`, `bot`) dejan de construir y pasan a
consumir la imagen publicada:

```yaml
x-app-image: &app-image
  image: ghcr.io/saul1hdz/novatareas:${NOVATAREAS_TAG:-latest}
```

`compose.dev.yml` no cambia: en desarrollo se sigue construyendo en local.

### Procedimiento de despliegue

```
NOVATAREAS_TAG=sha-a1b2c3d docker compose -p novatareas-prod -f compose.prod.yml pull
NOVATAREAS_TAG=sha-a1b2c3d docker compose -p novatareas-prod -f compose.prod.yml up -d
```

Consecuencias: en producción corre el artefacto exacto que pasó pruebas y
escaneo; el despliegue baja de minutos a segundos al desaparecer `npm ci` y el
build de Astro del servidor; y el rollback es relanzar el mismo comando con el
tag anterior, sin reconstruir nada.

### Restricciones del servidor compartido

- Usar **siempre** `-p novatareas-prod`. Nunca un `docker compose down` sin
  proyecto.
- **Nunca** `docker system prune` ni `docker image prune -a`: se llevaría por
  delante imágenes y volúmenes de otros servicios del VPS.
- No exponer el puerto 5432. La aplicación sigue escuchando en
  `127.0.0.1:4321` detrás del proxy inverso con TLS.

### Bloque para Argus, generado por el pipeline

Al final del trabajo de publicación, el workflow escribe en el resumen de la
ejecución un bloque copiable con:

- el tag exacto que se acaba de publicar,
- los dos comandos de despliegue ya rellenados,
- **si el commit trae migraciones nuevas**, comparando `migrations/postgresql/`
  contra el commit anterior,
- las restricciones del servidor compartido.

Argus deja de tener que deducir si el despliegue toca el esquema: se lo dice el
pipeline. Sigue siendo él quien decide y ejecuta.

### Prompt de traspaso a Argus (entregable)

Además del bloque automático, la implementación entrega **un prompt redactado
para pasarle a Argus** en su propia sesión, con el cambio de contrato completo:
que `compose.prod.yml` ya no construye, cuál es la nueva imagen y de dónde sale,
los dos comandos de despliegue, cómo hacer rollback, y las restricciones del VPS
compartido. Es la única vía por la que Argus se entera del cambio: las sesiones
no comparten contexto, y lo que no está escrito no cruza de una a otra.

## 7. Verificación

Un workflow no se prueba con tests unitarios. La verificación es por ejecución
real, en dos pasadas.

**Pasada 1 — que hace lo que dice.**

1. En una rama: observar el run completo y confirmar que construye, escanea y
   **no publica** — el registro sigue sin la imagen.
2. Ya en `main`: confirmar que la imagen aparece en GHCR con las tres
   etiquetas.
3. `docker pull` de esa imagen exacta en local, arrancarla contra una base de
   prueba y comprobar que `/api/v1/health/ready` responde 200. Esto cierra el
   círculo: lo publicado arranca de verdad.

**Pasada 2 — que las guardias saltan.** Hacer fallar cada una a propósito, una
vez, y revertir después:

| Guardia | Cómo se provoca el fallo | Qué debe pasar |
|---|---|---|
| Gitleaks | Commitear un secreto falso con formato reconocible | El trabajo de seguridad falla y señala el fichero |
| Trivy | Bajar el umbral a `LOW` temporalmente | El trabajo de imagen falla antes de publicar |
| `npm audit` | Fijar una dependencia con vulnerabilidad conocida | El trabajo de seguridad falla |
| Publicación condicionada | Push a una rama que no sea `main` | Construye y escanea, pero no publica |

Una guardia que nunca se ha visto fallar no se sabe si está encendida. Todo el
valor de esta sección depende de que salten cuando toca: un `continue-on-error`
mal puesto o un filtro demasiado ancho las deja pasando en verde para siempre
sin que nadie lo note.

## 8. Lo que este diseño no hace

- **No despliega en el VPS.** Decisión consciente: el despliegue automático
  aplicaría migraciones a producción sin revisión, y `release-manifest.yml`
  advierte de que volver el código no revierte el esquema.
- **No firma las imágenes** ni genera SBOM. Cabe más adelante; hoy añadiría
  ceremonia sin cubrir un riesgo presente.
- **No cambia la suite de pruebas** ni añade cobertura de aplicación.
- **No pone umbral de cobertura.** El reporte se sigue publicando como
  artefacto informativo.

## 9. Trabajo manual requerido

Fuera del alcance del repositorio, en Settings de `Saul1hdz/NovaTareas`
(la cuenta autenticada tiene `admin: true`, comprobado):

1. Habilitar **Dependabot alerts** y **security updates**.
2. Habilitar **Code scanning** con CodeQL.
3. Comprobar que en *Actions → General → Workflow permissions* los workflows
   pueden escribir paquetes.
4. Tras la primera publicación, marcar el paquete `novatareas` como **público**
   en la página del paquete. Los paquetes de GHCR nacen privados.

Ninguno de los cuatro se puede hacer desde el repositorio; los cuatro se
confirman mirando la interfaz, no suponiendo.
