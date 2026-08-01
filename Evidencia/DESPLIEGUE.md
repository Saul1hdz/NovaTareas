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
docker compose -f compose.prod.yml up -d --build web
```

Ese comando, en orden: levanta PostgreSQL, espera a que esté sano, ejecuta las
migraciones en un contenedor de un solo uso y solo entonces arranca la web. Si
las migraciones fallan, la web no llega a iniciarse.

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

## 6. Bot de Telegram

```bash
docker compose -f compose.prod.yml --profile telegram up -d bot
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

```bash
git fetch --all --tags
git checkout <nueva-etiqueta>
docker compose -f compose.prod.yml up -d --build web
```

Registra siempre qué commit está desplegado:

```bash
git rev-parse --short HEAD
```

## 9. Volver atrás

```bash
git checkout <etiqueta-anterior>
docker compose -f compose.prod.yml up -d --build web
```

Si la versión nueva aplicó migraciones, volver el código **no revierte el
esquema**. En ese caso restaura primero la copia previa a la migración y luego
despliega la versión anterior.

---

## 10. Operación diaria

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

Recorre esta lista tras cada publicación:

1. `/api/v1/health/ready` responde 200.
2. La página de inicio carga por HTTPS con certificado válido.
3. Se puede iniciar sesión con una cuenta de demostración.
4. Se crea una tarea y aparece en el listado.
5. Se sube un avatar y **sigue visible tras reiniciar el contenedor**.
6. El cron de recordatorios responde 200 con el `CRON_SECRET` y 401 sin él.
7. `docker compose -f compose.prod.yml ps` no muestra reinicios en bucle.
