# Despliegue de NovaTareas

Guía operativa para publicar NovaTareas en un VPS (Netcup) con Docker Compose.
Está escrita para ejecutarse de principio a fin sin conocer el historial del
proyecto.

**Alcance:** demo universitaria cerrada con usuarios ficticios. No es un
servicio público. El acceso debe restringirse al equipo y a los docentes.

---

## 1. Requisitos del servidor

- Docker Engine 24+ con el plugin `compose`.
- Un dominio o subdominio apuntando al VPS.
- Un proxy inverso con TLS (Caddy, nginx o Traefik) delante de la aplicación.
- Puertos 80 y 443 abiertos. **El 5432 nunca se expone.**

La aplicación escucha en `127.0.0.1:4321`; solo el proxy inverso debe alcanzarla.

---

## 2. Variables de entorno

Copia `.env.example` a `.env` en el servidor y complétalo. **Los secretos de
producción deben ser distintos a los de desarrollo.**

Genera cada secreto con:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

### Obligatorias

| Variable | Qué pasa si falta |
|---|---|
| `SECRET_KEY` | La aplicación **no arranca**: firma las sesiones. |
| `POSTGRES_PASSWORD` | El compose se niega a iniciar. |
| `DATABASE_URL` | La define `compose.prod.yml` a partir de `POSTGRES_PASSWORD`. |
| `CRON_SECRET` | El endpoint de recordatorios responde 503 y no se envía ningún aviso. |
| `NOVATAREAS_TAG` | El compose **aborta**: es la etiqueta de la imagen a desplegar y no tiene valor por defecto. Usa siempre `sha-<commit-corto>`, nunca `latest`. |

El registro público está cerrado por defecto. Define
`REGISTRATION_ENABLED=true` solo si deseas aceptar cuentas nuevas; el endpoint
aplica un máximo de 10 solicitudes por IP cada hora en PostgreSQL. Déjalo en
`false` para demos cerradas o cuando ya hayas creado las cuentas necesarias.

### Necesarias según la función que se active

| Variable | Para qué |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot de Telegram. Sin ella el contenedor `bot` sale con error. |
| `ZAI_API_KEY`, `ZAI_MODEL` | Recomendaciones con IA real. Sin ellas se usa el fallback por reglas. |
| `TOKEN_ENCRYPTION_KEY` | Google Calendar. Debe ser base64url de exactamente 32 bytes. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Calendar. El redirect **debe** apuntar al dominio HTTPS, no a localhost. |
| `APP_TIME_ZONE` | Zona para fechas y vencimientos. Por defecto `America/El_Salvador`. |

**No definas `OLLAMA_URL` si no hay un Ollama en el servidor.** El valor por
defecto apunta a `localhost:11434`; sin nada escuchando ahí, cada petición de IA
paga un tiempo de espera inútil antes de caer al fallback.

---

## 3. Primer despliegue

```bash
git clone <repo> novatareas && cd novatareas
git checkout <commit-o-etiqueta>
cp .env.example .env
# Editar .env con los secretos de producción.
```

```bash
export NOVATAREAS_TAG=sha-<commit-corto>
docker compose -f compose.prod.yml -f compose.server.yml up -d web
```

**`compose.server.yml` no es opcional.** Vive solo en el servidor y aporta los
límites de memoria y CPU, `no-new-privileges` y la configuración de registro;
un servicio arrancado sin él queda sin ninguna de esas protecciones. Ver la
sección 10.

Ese comando, en orden: levanta PostgreSQL, espera a que esté sano, ejecuta las
migraciones en un contenedor de un solo uso con la imagen publicada y solo
entonces arranca la web. Si las migraciones fallan, la web no llega a iniciarse.

**No construye nada**: descarga `ghcr.io/saul1hdz/novatareas` del registro. Para
las actualizaciones posteriores, usa el procedimiento de la sección 8, que añade
verificación de digest, ensayo de migración, copia de seguridad y rollback.

Comprobación:

```bash
curl -fsS http://127.0.0.1:4321/api/v1/health/ready
```

Debe responder `200` con `"database": true`. Si devuelve `503`, la aplicación
está viva pero **no puede atender**: revisa PostgreSQL antes de enrutar tráfico.

### Datos de demostración

```bash
docker compose -f compose.prod.yml exec web node scripts/seed-demo.mjs
```

Crea tres cuentas ficticias con tareas de ejemplo. Es idempotente: si ya existen
no cambia nada. Usa `SEED_RESET=1` para recrearlas.

---

## 4. Proxy inverso

La aplicación confía en la cabecera `X-Forwarded-For` para aplicar sus límites de
uso. **El proxy debe reescribirla, no reenviar la que llegue del cliente**, o
cualquiera podrá evadir el límite enviando una cabecera falsa.

Ejemplo con Caddy:

```
novatareas.ejemplo.test {
    reverse_proxy 127.0.0.1:4321 {
        header_up X-Forwarded-For {remote_host}
    }
}
```

Las cookies de sesión se marcan `Secure` automáticamente cuando `NODE_ENV` es
`production`, así que el servicio **solo funciona correctamente sobre HTTPS**.

---

## 5. Recordatorios

Los avisos se disparan desde fuera con una llamada HTTP autenticada. Añade al
cron del servidor:

```cron
*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://novatareas.ejemplo.test/api/cron/reminders > /dev/null
```

El endpoint es idempotente: cada tarea se avisa una sola vez gracias a los
indicadores `reminder_sent` y `overdue_notified`. Ejecutarlo de más no duplica
mensajes.

### 5.1 Comprobar que el cron existe de verdad

Esta línea de cron estuvo **meses documentada aquí y sin instalar** en el
servidor, y nadie se enteró: los recordatorios no salieron nunca y la aplicación
estuvo en verde todo ese tiempo, porque un trabajo programado muerto no produce
errores, produce silencio.

`GET /api/v1/health/jobs` convierte ese silencio en una señal. Publica cuándo
corrió por última vez cada trabajo y responde **503** si alguno lleva más de 45
minutos sin hacerlo —tres ciclos perdidos— o si **no se ha ejecutado nunca**:

```bash
curl -fsS https://novatareas.ejemplo.test/api/v1/health/jobs
```

Con el cron recién instalado y antes del primer barrido la respuesta es `503`
con `"stale": true` y `"last_run_at": null`. Debe pasar a `200` como muy tarde
15 minutos después; si no, el cron no está corriendo.

**El aviso lo da un vigilante externo a este servidor**, no la aplicación: quien
avisa no puede ser quien está caído. Basta una entrada de cron en otra máquina
que llame a la ruta con `curl -f` y notifique cuando el código no sea 0. Igual
que el resto de sondas, tiene que usar `curl`: ver el aviso sobre Cloudflare al
final de este documento.

La ruta **no** entra en el `HEALTHCHECK` del contenedor ni en el balanceador: un
cron parado no es motivo para sacar la web de servicio. Para eso está
`/api/v1/health/ready`, que sigue mirando solo la base de datos.

## 6. Bot de Telegram

```bash
docker compose --env-file .env -p novatareas-prod \
  -f compose.prod.yml -f compose.server.yml --profile telegram up -d --no-build bot
```

**Exactamente una instancia por token.** El bot usa polling, y dos procesos con
el mismo token se roban los mensajes entre sí. Arrancar el bot además elimina
cualquier webhook registrado previamente.

---

## 7. Copias de seguridad

Respalda **antes de cada despliegue que incluya migraciones**.

```bash
docker compose -f compose.prod.yml exec -T db \
  pg_dump -U novatareas -Fc novatareas > respaldo-$(date +%F-%H%M).dump
```

Restauración:

```bash
docker compose -f compose.prod.yml exec -T db \
  pg_restore -U novatareas -d novatareas --clean --if-exists < respaldo-XXXX.dump
```

Una copia que nunca se ha restaurado no es una copia. Prueba el procedimiento
completo en una base desechable antes de confiar en él.

---

## 8. Actualizar una versión

**El servidor ya no construye la imagen.** La publica CI en
`ghcr.io/saul1hdz/novatareas` después de pasar las pruebas, arrancar la imagen
contra una base real y escanearla con Trivy. Lo que corre en producción es ese
artefacto exacto, no una reconstrucción.

### Despliegue automático

Un detector vigila `main` y despliega **solo cuando el commit no toca
`migrations/postgresql/`**. Si lo toca, se detiene y avisa: un cambio de esquema
lo revisa una persona antes de aplicarse, porque volver el código no lo revierte.

La detección se hace por duplicado —el resumen del pipeline y el cálculo propio
del detector— y una discrepancia entre ambas fuentes también detiene el
despliegue. Cada decisión queda registrada en el servidor con el commit y el
motivo, para poder reconstruirla después.

Un cambio con migraciones se despliega a mano con el procedimiento de abajo.

### Procedimiento normal

```bash
sudo /usr/local/sbin/novatareas-release deploy-<sha40>
```

El `<sha40>` es el commit completo cuya imagen publicó CI. Cada ejecución del
pipeline en `main` deja en el resumen del run la etiqueta exacta y avisa de si
el commit trae migraciones nuevas.

El helper hace, en orden: descarga la imagen y **verifica su digest** contra el
aprobado; captura las imágenes actuales como red de rollback; ensaya la
migración contra un PostgreSQL descartable comparando conteos; comprueba que la
imagen anterior funciona contra el esquema ya migrado; hace copia de la base y
de los avatares; detiene `web` y `bot`; aplica la migración real; levanta con
`--no-build`; y confirma la salud en cinco ciclos. Si algo falla, revierte.

Comprobar el estado:

```bash
sudo /usr/local/sbin/novatareas-release status
```

Devuelve el commit desplegado, el digest de la imagen en ejecución y la salud de
cada servicio.

### Secuencia manual (solo referencia o emergencia)

```bash
cd /opt/stacks/novatareas

# 1) Descargar la imagen y verificar su digest
docker pull ghcr.io/saul1hdz/novatareas:sha-<commit-corto>
docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/saul1hdz/novatareas:sha-<commit-corto>

# 2) Validar la composición (no construye)
docker compose --env-file .env -p novatareas-prod \
  -f compose.prod.yml -f compose.server.yml config -q

# 3) Migrar (contenedor de un solo uso, con la imagen descargada)
docker compose --env-file .env -p novatareas-prod \
  -f compose.prod.yml -f compose.server.yml run --rm --no-deps migrate

# 4) Levantar web y bot
docker compose --env-file .env -p novatareas-prod \
  -f compose.prod.yml -f compose.server.yml up -d --no-build --no-deps web bot

# 5) Verificar
curl -fsS https://novatareas.polarzero.dev/api/v1/health/ready
```

**`NOVATAREAS_TAG` debe estar definida** y valer `sha-<commit-corto>` en todas
esas llamadas. No tiene valor por defecto: el compose aborta si falta, en vez de
caer a `latest`, que se mueve con cada push a `main` y haría que la migración se
aplicara con una imagen y el servicio arrancara con otra. El helper la exporta y
aborta si no coincide.

`compose.server.yml` vive solo en el servidor y aporta los límites de memoria y
CPU, `no-new-privileges` y la configuración de registro. **No está en el
repositorio**: un despliegue que lo omita arranca sin ninguna de esas
protecciones.

## 9. Volver atrás

```bash
sudo /usr/local/sbin/novatareas-release deploy-<sha40-anterior>
```

La imagen anterior sigue en la caché local del servidor, así que el retroceso no
depende de que el registro esté disponible.

Si la versión nueva aplicó migraciones, volver el código **no revierte el
esquema**. El helper distingue dos casos: si la migración avanzó pero la
aplicación nueva no llegó a arrancar, restaura la copia previa; si la aplicación
nueva sí arrancó, se apoya en la comprobación de compatibilidad que hizo antes
—la imagen anterior contra el esquema nuevo— y no toca la base.

Para retrocesos manuales, las copias de cada versión quedan en
`/opt/stacks/novatareas/backups/releases/<marca>-<sha>/`.

---

## 10. Operación diaria

> **Incluye siempre `-f compose.server.yml`** al levantar o recrear servicios.
> Ese fichero vive solo en el servidor y aporta los límites de memoria y CPU,
> `no-new-privileges` y la configuración de registro. Un servicio arrancado sin
> él queda sin esas protecciones. Para inspeccionar (`ps`, `logs`, `exec`) no
> hace falta.
>
> **El VPS es compartido.** Nunca ejecutes `docker system prune` ni
> `docker image prune -a`: se llevarían imágenes y volúmenes de otros
> servicios, incluidas las imágenes de rollback de NovaTareas.
>
> `NOVATAREAS_TAG` hace falta incluso para `ps` y `logs`: compose interpola el
> fichero entero antes de ejecutar cualquier subcomando. Basta con que esté en
> el `.env` del directorio del stack, que es donde debe vivir.

```bash
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f web
docker compose -f compose.prod.yml restart web
```

Detener conservando los datos:

```bash
docker compose -f compose.prod.yml --profile telegram down
```

**Nunca uses `down -v`**: elimina los volúmenes con la base de datos y los
avatares subidos.

---

## 11. Limitaciones conocidas

Cosas que conviene saber antes de que sorprendan:

- **Una sola réplica de web**, aunque ya no por el motivo original. Los límites
  de uso (`rate_limit_hits`), los tokens de recuperación (`recovery_tokens`) y
  las sesiones del bot (`telegram_sessions`) viven ahora en PostgreSQL, así que
  el recuento es el mismo para todos los procesos y sobrevive a los reinicios.
  Lo que falta para escalar de verdad es probarlo: nunca se ha corrido con más de
  una réplica.
- **Una sola réplica de bot**, y esta sí es obligatoria: usa polling, y dos
  procesos con el mismo token se roban los mensajes entre sí.
- **`reminder_at` no se escribe todavía** desde ninguna pantalla, así que el aviso
  previo al vencimiento no se dispara. El aviso de tarea vencida sí funciona.
- **Sin logs estructurados ni métricas.** La observabilidad se limita a
  `docker compose logs`.
- **Los avatares viven en un volumen del contenedor**, no en almacenamiento
  externo: entran en el respaldo solo si se respalda el volumen aparte.

---

## 12. Comprobación posterior al despliegue

> **Las sondas externas deben usar `curl`.** El dominio está detrás de
> Cloudflare con protección de bots activa, y esta filtra por huella TLS, no por
> user-agent: `wget` y `busybox wget` reciben `403` incluso en
> `/api/v1/health/ready`, que no pide autenticación. Una sonda que use `wget`
> informará de que el servicio está caído cuando está perfectamente sano. La
> regla vive en el panel de Cloudflare (zona `polarzero.dev`, Security → Bots),
> no en la configuración del servidor ni en este repositorio. El cron de
> recordatorios de la sección 5 ya usa `curl` y no le afecta.


Recorre esta lista tras cada publicación:

1. `/api/v1/health/ready` responde 200.
2. La página de inicio carga por HTTPS con certificado válido.
3. Se puede iniciar sesión con una cuenta de demostración y el registro responde
   según `REGISTRATION_ENABLED` (`403` si está cerrado).
4. Se crea una tarea y aparece en el listado.
5. Se sube un avatar y **sigue visible tras reiniciar el contenedor**.
6. El cron de recordatorios responde 200 con el `CRON_SECRET` y 401 sin él.
7. `docker compose -f compose.prod.yml ps` no muestra reinicios en bucle.
8. `/api/v1/health/jobs` responde 200 (sección 5.1). Que el endpoint del punto 6
   conteste solo dice que *puede* ejecutarse; este dice que *se está*
   ejecutando, que es la pregunta que nadie hizo durante meses.
