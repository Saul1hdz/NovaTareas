# Sección para agregar al README.md

Inserta este bloque después de la sección **"9. Instalación y ejecución"**
(o donde prefieras), y renumera las secciones siguientes.

---

## 10. Pruebas automatizadas

El proyecto usa **Vitest** para las pruebas. Las pruebas no requieren conexión a
internet ni credenciales: el motor de IA cae automáticamente a su fallback de
reglas locales cuando no hay `ZAI_API_KEY`, lo que las hace rápidas y
deterministas.

### Comandos

```bash
# Ejecutar todas las pruebas una vez
npm test

# Ejecutar en modo observador (se relanzan al guardar cambios)
npm run test:watch

# Ejecutar con reporte de cobertura
npm run test:coverage

# Verificar tipos y sintaxis del proyecto
npm run lint
```

### Qué se prueba

| Archivo | Pruebas | Cobertura |
|---|---|---|
| `tests/aiEngine.test.js` | 14 | Validación de entrada: títulos vacíos, límites de longitud, prioridades inválidas, fechas mal formadas |
| `tests/api.test.js` | 11 | Endpoints `/api/v1/health`, `/api/v1/metadata` y `/api/v1/recommend` (respuestas exitosas y errores controlados) |

**Total: 25 pruebas.**

Las pruebas de endpoints siguen el mismo principio que `TestClient` de FastAPI:
importan el handler y le pasan un objeto `Request`, sin necesidad de levantar el
servidor ni abrir un puerto.

### Ejecución en cada push

El archivo `.github/workflows/ci.yml` ejecuta automáticamente en GitHub Actions:

1. Instalación de dependencias con `npm ci`.
2. Verificación de tipos (`npm run lint`).
3. Ejecución de las pruebas (`npm test`).
4. Compilación del proyecto (`npm run build`).

Registro de errores detectados y corregidos:
[`docs/registro-pruebas-semana-3.md`](docs/registro-pruebas-semana-3.md).

### Migraciones de base de datos

```bash
npm run migrate   # ejecuta las 5 migraciones en el orden correcto
```
