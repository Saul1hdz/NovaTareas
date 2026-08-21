# Plan de contingencia

Qué hacer cuando NovaTareas Pro falla: cómo se detecta, qué se hace en el
momento, cómo se vuelve atrás y qué se pierde mientras tanto.

Está escrito para leerse **bajo presión**, así que cada fallo trae lo mismo:
síntoma, impacto real, respuesta inmediata y prevención. No es un plan
hipotético: varios de los casos que aparecen aquí ya ocurrieron durante el
desarrollo o tras publicar.

> La última sección cubre el caso particular de una demostración en vivo, donde
> no hay tiempo de reparar nada y lo único que importa es tener el siguiente
> plan listo.

---

## 1. Principio de fondo: degradar antes que caer

El sistema está diseñado para perder capacidades una a una en lugar de dejar de
funcionar entero. Conviene tener claro **qué sigue vivo cuando falla cada
pieza**, porque eso decide la urgencia de la respuesta.

| Si falla… | Qué deja de funcionar | Qué sigue funcionando |
|---|---|---|
| El proveedor de IA en la nube | La mejor calidad de recomendación | Todo lo demás; la recomendación baja de escalón automáticamente |
| El modelo local | Un escalón de respaldo | El historial propio y las reglas locales siguen respondiendo |
| El servidor de correo | Registro de cuentas nuevas y recuperación de contraseña | Las cuentas existentes entran y trabajan con normalidad |
| El bot de Telegram | Avisos y creación de tareas por chat | El panel web completo |
| La base de datos | **Todo** | Nada: es la única pieza sin respaldo automático |
| La aplicación web | **Todo, incluida la API** | Nada |

Las dos últimas filas son las que exigen respuesta inmediata. El resto admite
horas sin que nadie se quede sin trabajar.

---

## 2. Cómo se detecta un fallo

Tres señales, de la más barata a la más detallada.

```bash
# 1. ¿Está viva la aplicación y le responde la base de datos?
curl https://novatareas.polarzero.dev/api/v1/health/ready

# 2. ¿Qué versión está sirviendo?
curl https://novatareas.polarzero.dev/api/v1/metadata

# 3. ¿Qué proveedores de IA tiene disponibles?
curl https://novatareas.polarzero.dev/api/v1/health
```

| Respuesta | Interpretación |
|---|---|
| `{"status":"ok","checks":{"database":true}}` | Sistema sano |
| `database: false` | La aplicación vive pero la base no responde → §4.2 |
| Sin respuesta | Aplicación o servidor caídos → §4.1 |
| Versión distinta de la esperada | El despliegue no se aplicó → §4.7 |
| `zai_configured: false` | Sin proveedor principal de IA → §4.3 |

**Para investigar un fallo concreto**, cada solicitud deja una línea de registro
con un identificador propio, que además viaja al usuario en la cabecera
`x-request-id`. Si alguien reporta un error y da ese identificador, la línea
exacta se encuentra sin buscar por hora:

```bash
docker compose -f compose.prod.yml logs web | grep <identificador>
docker compose -f compose.prod.yml logs web | grep '"level":"error"'
```

---

## 3. Niveles de urgencia

| Nivel | Qué significa | Respuesta |
|---|---|---|
| **Crítico** | Nadie puede usar el sistema, o hay riesgo para los datos | Atención inmediata; se vuelve a la versión anterior sin dudarlo |
| **Alto** | Una función central no responde y afecta a todos | Atención el mismo día |
| **Medio** | Una función se degradó pero hay alternativa | Se corrige en la siguiente versión |
| **Bajo** | Molestia sin pérdida de función | Entra en la lista de pendientes |

Regla práctica: **si la reparación no se ve clara en quince minutos, se vuelve
atrás y se investiga con calma**. Volver a la versión anterior es un
procedimiento probado; improvisar sobre producción, no.

---

## 4. Catálogo de fallos

### 4.1 La aplicación no responde — Crítico

**Síntoma**: la URL no carga; `curl` no devuelve nada.

**Respuesta**:

```bash
docker compose -f compose.prod.yml ps          # ¿está el contenedor en pie?
docker compose -f compose.prod.yml logs --tail=100 web
docker compose -f compose.prod.yml restart web
```

Si el contenedor se reinicia en bucle, el problema está en el arranque: casi
siempre una variable de entorno ausente o una migración que no se pudo aplicar.
Los registros lo dicen en las primeras líneas.

Si no se resuelve rápido, volver a la versión anterior (§5.2).

**Prevención**: la comprobación posterior a cada publicación (§5.4) detecta esto
antes de que lo note un usuario.

### 4.2 La base de datos no responde — Crítico

**Síntoma**: `/api/v1/health/ready` devuelve `database: false`.

**Respuesta**:

```bash
docker compose -f compose.prod.yml ps db
docker compose -f compose.prod.yml logs --tail=100 db
docker compose -f compose.prod.yml restart db
```

Si el motor no arranca, revisar espacio en disco antes que nada: un volumen
lleno es la causa más frecuente. Si hay corrupción, restaurar la última copia
(§5.3).

**Prevención**: copias antes de cada despliegue con migraciones, y vigilar el
espacio del volumen de datos.

### 4.3 El proveedor de IA no responde o se quedó sin cuota — Medio

**Síntoma**: las recomendaciones tardan más o suenan genéricas;
`/api/v1/health` muestra `zai_configured: false` o el proveedor falla.

**Respuesta**: **ninguna urgente**. El sistema ya lo maneja solo: baja al
siguiente escalón —modelo local, historial del propio usuario, reglas
propias— y sigue respondiendo. Cada recomendación guarda de qué escalón salió,
así que después se puede medir cuánto tiempo se estuvo degradado.

Cuando convenga restablecerlo: recargar la cuota del proveedor y comprobar con
`/api/v1/health`.

**Prevención**: revisar el saldo antes de periodos de uso intenso. Las cuotas de
uso por usuario están limitadas y persistidas, de modo que un consumo anómalo no
agota el saldo de golpe.

### 4.4 El bot de Telegram no responde — Alto

**Síntoma**: se escribe al bot y no contesta; los avisos dejan de llegar.

**Respuesta**:

```bash
docker compose -f compose.prod.yml --profile telegram ps
docker compose -f compose.prod.yml --profile telegram restart bot
```

> **Cuidado con la causa más común**: el bot usa *polling* y **solo puede haber
> un proceso con el mismo token**. Si alguien levantó otro bot en su máquina
> para probar, los dos se roban los mensajes y ninguno funciona bien. Antes de
> investigar nada más, confirmar que nadie tiene el bot corriendo en local.

**Prevención**: no arrancar el bot fuera del servidor. En el entorno de
desarrollo vive detrás de un perfil opcional justo para que no se levante por
descuido.

### 4.5 El correo no sale — Alto

**Síntoma**: nadie puede registrarse ni recuperar su contraseña; el registro
responde con error de servicio.

**Impacto**: las cuentas existentes no se ven afectadas. Solo se bloquea la
entrada de usuarios nuevos y la recuperación.

**Respuesta**: comprobar el servidor de correo y las variables `SMTP_*`. Como
medida temporal se puede desactivar la exigencia de verificación
(`EMAIL_VERIFICATION_REQUIRED`), asumiendo que se acepta el riesgo de cuentas
sin correo confirmado.

**Prevención**: probar el envío después de cada cambio en la configuración de
correo.

### 4.6 «Petición de origen cruzado rechazada» — Alto

**Síntoma**: los usuarios no pueden crear ni editar tareas; aparece ese mensaje.

**Causa**: la protección contra peticiones de origen no autorizado no reconoce
el origen real. Ocurre cuando cambia el proxy que termina el HTTPS y deja de
enviar las cabeceras que indican el esquema original.

**Respuesta**: comprobar que el proxy inverso envía `X-Forwarded-Proto`. Si el
cambio vino con una versión nueva, volver atrás (§5.2).

> Esto pasó de verdad al publicar detrás de Cloudflare: el servidor se veía a sí
> mismo en HTTP mientras el navegador hablaba HTTPS. Quedó corregido y cubierto
> con una prueba automática, pero un cambio de proxy puede reabrirlo.

### 4.7 El despliegue no aplicó la versión nueva — Medio

**Síntoma**: `/api/v1/metadata` sigue mostrando la versión anterior.

**Respuesta**: reconstruir forzando la imagen y confirmar qué commit está
desplegado:

```bash
docker compose -f compose.prod.yml up -d --build web
git rev-parse --short HEAD
```

### 4.8 Una migración falló a mitad — Crítico

**Síntoma**: el contenedor de migraciones termina con error y la aplicación no
arranca, o arranca y falla al consultar una tabla o columna.

**Respuesta**: **no improvisar sobre el esquema**. Restaurar la copia previa a
la migración (§5.3) y después desplegar la versión anterior. Investigar la
migración en un entorno local antes de volver a intentarlo.

**Prevención**: copia obligatoria antes de cada despliegue con migraciones. Las
migraciones se prueban en local y en el proceso automático sobre una base limpia
antes de llegar al servidor.

### 4.9 El certificado HTTPS caducó — Alto

**Síntoma**: el navegador advierte que el sitio no es seguro.

**Respuesta**: renovar el certificado en el proxy inverso y recargarlo.

**Prevención**: renovación automática y un aviso propio con margen suficiente.

### 4.10 Una credencial quedó expuesta — Crítico

**Síntoma**: una clave, un token o una contraseña aparecieron en un repositorio,
en un mensaje o en una captura.

**Respuesta**, en este orden:

1. **Rotar la credencial** en el proveedor correspondiente. Borrar el mensaje o
   el commit **no elimina el incidente**: hay que dar por comprometido el valor.
2. Actualizar el `.env` del servidor y volver a desplegar.
3. Si la clave comprometida es la de sesiones, cambiarla invalida todas las
   sesiones abiertas, que es justo lo que se quiere.
4. Registrar qué se expuso, cuándo y qué se hizo.

**Prevención**: los secretos nunca se versionan; lo que está en el repositorio
es un archivo de ejemplo con marcadores. Los registros del sistema no publican
cuerpos, cabeceras, contraseñas ni correos.

### 4.11 Se perdieron datos — Crítico

**Síntoma**: faltan tareas, usuarios o comentarios.

**Respuesta**: **detener la aplicación antes de tocar nada**, para que no siga
escribiendo sobre un estado dañado. Restaurar la copia más reciente anterior al
incidente (§5.3) y aceptar la pérdida del intervalo entre esa copia y el fallo.

---

## 5. Procedimientos

### 5.1 Reinicio ordenado

```bash
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml restart web
docker compose -f compose.prod.yml logs -f web
```

### 5.2 Volver a la versión anterior

```bash
git checkout v1.0.0
docker compose -f compose.prod.yml up -d --build web
```

> **El límite que hay que tener presente**: volver el código **no revierte el
> esquema de la base de datos**. Si la versión que se abandona aplicó
> migraciones, primero se restaura la copia previa y después se despliega la
> versión anterior. En el orden inverso, el código viejo se encuentra un esquema
> que no entiende.

### 5.3 Restaurar una copia

```bash
docker compose -f compose.prod.yml exec -T db \
  pg_restore -U novatareas -d novatareas --clean --if-exists < respaldo-XXXX.dump
```

### 5.4 Comprobar que el sistema quedó sano

Después de cualquier reparación o despliegue, las siete comprobaciones del
runbook: la sonda responde 200, la portada carga por HTTPS, se puede iniciar
sesión, se crea una tarea, un avatar subido sobrevive al reinicio del
contenedor, el proceso de recordatorios responde con su credencial y falla sin
ella, y ningún contenedor se reinicia en bucle.

Detalle completo en [`../DESPLIEGUE.md`](../DESPLIEGUE.md).

---

## 6. Copias de seguridad

```bash
docker compose -f compose.prod.yml exec -T db \
  pg_dump -U novatareas -Fc novatareas > respaldo-$(date +%F-%H%M).dump
```

| Cuándo | Por qué |
|---|---|
| **Antes de cada despliegue con migraciones** | Obligatorio: es la única vuelta atrás real del esquema |
| Periódicamente | Para acotar cuánto se pierde ante un fallo de datos |
| Antes de cualquier operación manual sobre la base | Nunca se toca producción sin red |

> **Una copia que nunca se ha restaurado no es una copia.** El procedimiento de
> restauración debe probarse completo sobre una base desechable antes de
> confiar en él.

Los avatares subidos por los usuarios viven en un volumen aparte y también deben
respaldarse: no están dentro del volcado de la base.

---

## 7. Límites conocidos de este plan

Dicho de frente, porque un plan de contingencia que promete de más es peor que
no tenerlo:

- **No hay alta disponibilidad.** El sistema corre en un solo servidor: si la
  máquina cae, no hay otra que tome el relevo.
- **No hay conmutación automática.** Todas las respuestas de este documento son
  manuales y requieren que alguien entre al servidor.
- **El bot no se puede duplicar** mientras use *polling*, así que su
  disponibilidad depende de un único proceso.
- **La ventana de pérdida de datos** es el tiempo transcurrido desde la última
  copia. Sin copias programadas, puede ser considerable.
- **No hay vigilancia automática**: nadie recibe un aviso si el sistema cae de
  madrugada. La detección depende de que alguien mire.

Cerrar estos huecos exige más infraestructura de la que el proyecto tiene hoy, y
está anotado como trabajo pendiente.

---

## 8. Caso particular: una demostración en vivo

Aquí no hay tiempo de reparar nada. Lo único que cuenta es **tener el siguiente
plan listo y no quedarse en silencio**.

**Antes**: comprobar las tres señales de §2, dejar tareas ya creadas en la cuenta
que se usará, tener el entorno local levantado una vez para saber que arranca, y
grabar un recorrido de respaldo.

**Durante**, en orden, sin insistir más de un minuto en ninguno:

1. La aplicación publicada.
2. El entorno local en contenedores: `docker compose -f compose.dev.yml up -d`,
   y `npm run db:seed` si hace falta poblarlo. **Sin los perfiles del bot ni del
   planificador**, por lo dicho en §4.4.
3. El recorrido grabado.
4. Las láminas y las capturas.

**Qué decir** en los dos fallos más probables:

- **La IA responde lenta o genérica**: no es un fallo que ocultar, es la cascada
  funcionando. Explicar que el sistema bajó de escalón y que por eso el usuario
  nunca se queda sin respuesta.
- **La aplicación no carga**: pasar al entorno local explicando que es el mismo
  sistema, y que arranca igual en cualquier máquina porque la configuración vive
  en el repositorio.

Una sola persona toca el teclado. Dos intentando arreglar lo mismo a la vez es
la forma más rápida de perder la demostración.

---

## 9. Después de un incidente

- Anotar qué falló, cuándo se detectó, qué se hizo y cuánto duró.
- Si hubo credenciales de por medio, confirmar que se rotaron.
- Si el fallo pudo haberse detectado antes, añadir la señal que faltaba.
- Si fue un error de código, escribir la prueba que lo habría atrapado. Esa es
  la única forma de que un fallo no vuelva dos veces.
