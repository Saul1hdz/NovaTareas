# Entorno de desarrollo en Windows con Docker Desktop

Guía para levantar NovaTareas en Windows usando Docker Desktop. Recoge las
diferencias reales frente a ejecutarlo en Linux y los fallos que aparecen si no
se tienen en cuenta.

---

## 1. Antes de clonar: dónde poner el proyecto

**No lo clones dentro de OneDrive.** Es la recomendación más importante de este
documento y la que evita más problemas raros.

El contenedor monta la carpeta del proyecto y **escribe de vuelta** en ella
(`.astro/`, `dist/`). OneDrive intentará sincronizar miles de archivos de
compilación, y mientras los sincroniza puede bloquearlos: el contenedor recibe
errores de permisos intermitentes que parecen bugs de la aplicación. Además, con
*Archivos a petición* un archivo "solo en la nube" puede llegar vacío al
contenedor.

Usa una ruta fuera de OneDrive:

```powershell
git clone <repo> C:\dev\NovaTareas
cd C:\dev\NovaTareas
```

Si por lo que sea tiene que quedarse en OneDrive, entra en la configuración de
OneDrive y excluye esa carpeta de la sincronización.

## 2. Configuración de Docker Desktop

En **Settings → General**, activa **"Use the WSL 2 based engine"**. Con el motor
Hyper-V antiguo hay que compartir unidades a mano y el límite de memoria por
defecto (2 GB) hace que `npm run build` muera sin explicación.

Si tu equipo tiene 8 GB de RAM o menos, crea `%USERPROFILE%\.wslconfig`:

```
[wsl2]
memory=6GB
processors=4
```

y reinicia WSL con `wsl --shutdown`. Sin esto, compilar Astro junto a PostgreSQL
en el mismo espacio puede terminar con el proceso eliminado por falta de memoria
(código de salida 137), que no dice nada útil.

## 3. Puesta en marcha

```powershell
Copy-Item .env.example .env
```

Usa `Copy-Item`, **no** `Out-File` ni `>` ni el Bloc de notas guardando en
UTF-16. PowerShell puede añadir una marca BOM o finales de línea `\r` al archivo,
y Docker Compose los mete **dentro del valor** de la variable: `SECRET_KEY` con
un `\r` al final produce fallos de firma de sesión imposibles de diagnosticar.

Luego edita `.env` con VS Code y completa solo lo que vayas a probar.

```powershell
docker compose -f compose.dev.yml up -d --build web
```

Ese comando levanta PostgreSQL, espera a que esté sano, aplica las migraciones y
solo entonces arranca la web en http://127.0.0.1:4321.

Comprobación:

```powershell
docker compose -f compose.dev.yml ps
```

## 4. Base de datos de pruebas

`npm test` corre contra PostgreSQL real, así que necesita su propia base. Créala
**una sola vez**:

```powershell
docker compose -f compose.dev.yml exec db createdb -U novatareas novatareas_test
```

> Si la ejecutas otra vez verás `database "novatareas_test" already exists`. **Ese
> error es esperado y se ignora**: significa que ya está creada.

Después:

```powershell
npm ci
npm test
```

El nombre de la base **debe terminar en `_test`**. El arranque de las pruebas
borra el esquema completo en cada ejecución y se niega a hacerlo sobre cualquier
otra base, para que nadie borre sin querer sus datos de desarrollo.

## 5. Si el puerto 5434 o el 4321 están ocupados

Windows reserva rangos de puertos dinámicos cuando Hyper-V o WSL2 están activos.
Si al levantar Docker ves `bind: An attempt was made to access a socket in a way
forbidden by its access permissions`, el puerto está en un rango reservado y
reiniciar Docker no lo arregla.

Comprueba los rangos excluidos:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

Solución rápida: usar otro puerto para PostgreSQL en `.env`.

```
POSTGRES_PORT=5435
TEST_DATABASE_URL=postgresql://novatareas:devpassword@127.0.0.1:5435/novatareas_test
DATABASE_URL=postgresql://novatareas:devpassword@127.0.0.1:5435/novatareas
```

Cambia **las tres**: la primera es la que publica Docker y las otras dos son las
que usan las pruebas y las herramientas ejecutadas desde Windows.

## 6. Los cambios en el código no se reflejan

El montaje de la carpeta del proyecto desde Windows no propaga los avisos de
cambio de archivo al contenedor Linux, así que la recarga automática de Astro
puede no enterarse de nada. Si editas y el navegador no refresca, añade al
servicio `web` de `compose.dev.yml`:

```yaml
    environment:
      <<: *app-environment
      CHOKIDAR_USEPOLLING: "1"
```

Consume algo más de CPU, pero funciona. La alternativa mejor es clonar el
proyecto dentro del sistema de archivos de WSL2 (`\\wsl$\...`), donde el montaje
es nativo y la recarga funciona sin trucos.

## 7. Después de cambiar las dependencias

Las dependencias del contenedor viven en un volumen propio, separado de las que
`npm ci` instala en Windows. Es a propósito: algunos paquetes tienen binarios
distintos para cada sistema operativo.

El efecto secundario: el volumen **solo se rellena la primera vez**. Si alguien
añade una dependencia y tú haces `up -d --build web`, la imagen se reconstruye
pero el volumen conserva las dependencias viejas y verás `Cannot find module`.

Remedio, borrando **solo** ese volumen:

```powershell
docker compose -f compose.dev.yml down
docker volume rm novatareas_novatareas_node_modules
docker compose -f compose.dev.yml up -d --build web
```

> **Nunca uses `docker compose down -v`**: eso borraría también el volumen con la
> base de datos y los avatares.

## 8. Cosas que sorprenden pero son correctas

- **Los avatares que subas no aparecen en la carpeta del proyecto.** Viven en un
  volumen de Docker, no en `public/avatars`. Es intencional: así sobreviven a las
  reconstrucciones de la imagen.
- **El contenedor `migrate` aparece como "Exited".** Es correcto: se ejecuta una
  vez, aplica las migraciones y termina.
- **El bot y el planificador no arrancan solos.** Están tras perfiles:

  ```powershell
  docker compose -f compose.dev.yml --profile telegram up -d bot
  ```

  Recuerda que solo puede haber **una instancia del bot por token** en todo el
  equipo. Confirma que ningún compañero lo tenga corriendo antes de arrancarlo.

## 9. Detener sin perder datos

```powershell
docker compose -f compose.dev.yml --profile telegram down
```

## 10. Comprobación rápida de que todo está bien

```powershell
docker compose -f compose.dev.yml ps
npm test
npm run lint
npm run build
```

Resultado esperado: los contenedores `db` y `web` en estado *healthy*, 103
pruebas en verde, 0 errores de lint y compilación correcta.

Para una verificación funcional de extremo a extremo, con el servidor levantado:

```powershell
npm run db:pg:smoke
```
