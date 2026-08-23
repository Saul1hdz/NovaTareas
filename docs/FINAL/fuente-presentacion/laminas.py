# -*- coding: utf-8 -*-
"""Contenido de las ocho láminas de la presentación final.

Uso:

    python laminas.py ../presentacion-final.pdf

El estilo —lienzo, paleta y primitivas de dibujo— vive en `estilo.py`.
"""
from estilo import *  # noqa: F403

# Contenido de las ocho láminas. Se une a cabecera.py, que trae el lienzo,
# la paleta y las primitivas de dibujo.
#
# Tono: explicar qué es cada cosa y por qué está así. Los datos aparecen solo
# cuando ayudan a entender, no como demostración.

# ── 1. Portada ───────────────────────────────────────────────────────────────
fondo()
c.setFillColor(colors.HexColor('#171733'))
c.rect(0, 0, 8, ALTO, fill=1, stroke=0)
c.setFillColor(ACENTO)
c.rect(0, 90, 8, 250, fill=1, stroke=0)

c.setFont('Texto', 11.5)
c.setFillColor(ACENTO)
c.drawString(MARGEN, ALTO - 78, 'UNIVERSIDAD GERARDO BARRIOS')
c.setFont('Texto', 9.6)
c.setFillColor(GRIS)
c.drawString(MARGEN, ALTO - 95,
             'Módulo 4 — Desarrollo de Aplicaciones con IA  ·  Docente: Ing. Marco Arévalo Zambrano')

c.setFont('Negrita', 60)
c.setFillColor(BLANCO)
c.drawString(MARGEN, ALTO - 185, 'NovaTareas Pro')

c.setFont('Ligera', 19)
c.setFillColor(GRIS)
c.drawString(MARGEN, ALTO - 216, 'Asistente personal inteligente de gestión de tareas')

c.setStrokeColor(BORDE)
c.setLineWidth(0.8)
c.line(MARGEN, ALTO - 250, MARGEN + 420, ALTO - 250)

c.setFont('Negrita', 10)
c.setFillColor(ACENTO)
c.drawString(MARGEN, ALTO - 282, 'EQUIPO 3')

y = ALTO - 312
for nombre, carne in [
    ('Saúl Oswaldo López Hernández', 'SMIS108421'),
    ('Moises Antonio Martínez', 'SMIS071221'),
    ('Enson Onan Carranza Rodríguez', 'SMIS013020'),
]:
    c.setFont('Texto', 13.5)
    c.setFillColor(BLANCO)
    c.drawString(MARGEN, y, nombre)
    c.setFont('Mono', 10)
    c.setFillColor(GRIS)
    c.drawString(MARGEN + 260, y, carne)
    y -= 27

# Dónde vive el proyecto. Sin métricas: eso se explica en su lámina.
caja_x, caja_y, caja_ancho, caja_alto = ANCHO - MARGEN - 268, 196, 268, 128
c.setFillColor(FONDO2)
c.setStrokeColor(ACENTO)
c.setLineWidth(1.1)
c.roundRect(caja_x, caja_y, caja_ancho, caja_alto, 10, fill=1, stroke=1)

cursor = caja_y + caja_alto - 32
for etiqueta, valor, fuente, tam, color_valor in [
    ('EN LÍNEA', 'novatareas.polarzero.dev', 'Negrita', 13, ACENTO2),
    ('VERSIÓN', 'v1.0.0', 'Mono', 12, BLANCO),
]:
    c.setFont('Texto', 8.4)
    c.setFillColor(GRIS)
    c.drawString(caja_x + 20, cursor, etiqueta)
    c.setFont(fuente, tam)
    c.setFillColor(color_valor)
    c.drawString(caja_x + 20, cursor - 20, valor)
    cursor -= 56
c.showPage()

# ── 2. Diagnóstico, README y arquitectura ────────────────────────────────────
fondo()
encabezado(1, 'Diagnóstico, README y arquitectura',
           'Qué problema resuelve, para quién, y cómo está construido por dentro')

fin = cuerpo(ALTO - 122, [
    (
        ('El problema y a quién le pasa', [
            '*Estudiantes de la UGB — encuesta de febrero de 2026',
            '8 de cada 10 olvidan al menos una entrega por ciclo.',
            'Las apps que existen cobran, están en inglés y no aprenden de cómo trabaja cada persona.',
        ]),
        ('De dónde venimos y qué falta', [
            '*Empezó local, sin pruebas y sin forma de medir nada.',
            'Hoy está publicado, con base de datos de verdad y pruebas que corren solas en cada cambio.',
            'Sigue debiendo: la pantalla principal es un archivo demasiado grande.',
        ]),
    ),
], y_abajo=232)

# La cascada se entiende mejor vista que enumerada.
px, py, pw, ph = panel(MARGEN, 56, ANCHO - 2 * MARGEN, 168,
                       'Qué hace la IA: si un escalón falla, entra el siguiente')
cascada(px, py, pw, ph - 6, [
    ('z.ai · glm-4.5-flash', 'modelo en la nube, mejor calidad'),
    ('Ollama local', 'si el de la nube no responde'),
    ('Tu propio historial', 'busca tareas parecidas que ya cerraste'),
    ('Reglas locales', 'sin internet, siempre responde'),
])
pie(2)
c.showPage()

# ── 3. API inteligente y contratos ───────────────────────────────────────────
fondo()
encabezado(2, 'API inteligente y contratos',
           'La capacidad de IA ofrecida como un servicio que cualquiera puede consultar')
cuerpo(ALTO - 122, [
    (
        ('Qué significa exponerla como API', [
            'La misma inteligencia que usa el panel se puede pedir desde fuera, con una llamada y una credencial propia.',
            '*Cuatro direcciones: pedir recomendación, consultar el contrato, ver el estado del servicio y comprobar si está listo para atender.',
        ]),
        ('El contrato: qué se pide y qué se recibe', [
            'Se envía el título de la tarea y, si se quiere, descripción, prioridad, tipo de usuario y fecha límite.',
            'Se recibe la recomendación y, junto a ella, de dónde salió.',
            '*El servicio publica ese contrato él mismo, así nadie trabaja con una documentación que quedó vieja.',
        ]),
    ),
    (
        ('Por qué se valida antes', [
            'Revisar la entrada evita gastar una llamada al modelo en algo que nunca iba a funcionar, y protege de datos con mala forma.',
            'Se comprueban límites de longitud, valores permitidos y fechas.',
        ]),
        ('Qué pasa cuando algo falla', [
            'Sin credencial responde 401; con datos inválidos, 400 y el motivo.',
            '*El estado del servicio se informa siempre, incluso si los proveedores de IA están caídos: gracias al respaldo propio, la aplicación sigue siendo capaz de contestar.',
        ]),
    ),
])
pie(3)
c.showPage()

# ── 4. Pruebas y CI/CD ───────────────────────────────────────────────────────
fondo()
encabezado(3, 'Pruebas y CI/CD',
           'Cómo sabemos, sin revisarlo a mano, que un cambio no rompió nada')

cuerpo(ALTO - 122, [
    (
        ('Qué se prueba', [
            '*Cada prueba describe un comportamiento y falla si deja de cumplirse.',
            'Corren contra la misma base de datos que usa producción, no contra una imitación.',
        ]),
        ('También lo que no debería poder hacerse', [
            '*Diez pruebas intentan romper el sistema a propósito.',
            'Entrar en la tarea de otro, editar sin permiso, reutilizar un enlace usado, colar un ejecutable como imagen.',
        ]),
    ),
], y_abajo=248)

px, py, pw, ph = panel(MARGEN, 56, ANCHO - 2 * MARGEN, 184,
                       'Qué ocurre en cada cambio: tres trabajos, no una lista de pasos')
destino, ancho_der = flujo(px, py, pw, ph - 8,
    ('Pruebas, PostgreSQL y build',
     ['tipos y sintaxis', 'migración efímera', 'suite completa', 'compilación']),
    ('Cadena de suministro',
     ['auditoría de dependencias', 'secretos en el historial', 'análisis estático']))

# La tercera caja, la que solo arranca si las dos anteriores pasan.
c.setFillColor(colors.HexColor('#241f4d'))
c.setStrokeColor(ACENTO2)
c.setLineWidth(1.3)
c.roundRect(destino, py, ancho_der, ph - 8, 6, fill=1, stroke=1)
c.setFont('Negrita', 9.4)
c.setFillColor(BLANCO)
c.drawString(destino + 11, py + ph - 25, 'Imagen de producción')
c.setFont('Texto', 8.3)
c.setFillColor(GRIS)
cursor = py + ph - 39
for linea in ['construcción de la imagen', 'migra usando la propia imagen',
              'arranca y consulta la sonda', 'análisis de vulnerabilidades',
              'publicación en el registro']:
    c.drawString(destino + 11, cursor, '· ' + linea)
    cursor -= 11
pie(4)
c.showPage()

# ── 5. Despliegue e infraestructura ──────────────────────────────────────────
fondo()
encabezado(4, 'Despliegue e infraestructura',
           'Cómo pasa de una computadora a estar disponible en internet')
cuerpo(ALTO - 122, [
    (
        ('Reproducible quiere decir esto', [
            'Todo lo necesario para levantar el sistema está escrito en el repositorio: versiones, servicios y orden de arranque.',
            '*Un mismo comando lo levanta igual en cualquier máquina, sin pasos manuales que solo conozca quien lo hizo.',
        ], 'docker compose -f compose.prod.yml up -d'),
        ('Cómo está montado en el servidor', [
            'Cuatro piezas: la base de datos, un paso que aplica los cambios de estructura, la aplicación web y el bot de Telegram.',
            'Delante va un portero con HTTPS; la aplicación no se expone sola.',
            '*La base de datos no es alcanzable desde fuera del servidor.',
        ]),
    ),
    (
        ('De qué depende', [
            'Doce librerías para funcionar, sin capas de más.',
            'Y tres servicios externos: el proveedor de IA, Telegram para los avisos y un servidor de correo para verificar cuentas.',
        ]),
        ('Qué cuesta y bajo qué supuestos', [
            'Todo cabe en un servidor pequeño: un alquiler mensual modesto más el dominio.',
            'El proveedor de IA tiene cuota limitada; si se agota, el sistema no se cae, solo responde con su respaldo propio.',
            '*Pensado para decenas de personas a la vez, no para tráfico masivo.',
        ]),
    ),
])
pie(5)
c.showPage()

# ── 6. Observabilidad, rendimiento y escalabilidad ───────────────────────────
fondo()
encabezado(5, 'Observabilidad, rendimiento y escalabilidad',
           'Medir antes de optimizar: el cuello de botella no estaba donde parecía')

cuerpo(ALTO - 122, [
    (
        ('Qué anota el sistema', [
            '*Cada visita deja una línea con su identificador propio.',
            'Qué se pidió, cómo terminó, cuánto tardó y qué versión respondió.',
            'Nunca se anotan contraseñas, correos ni enlaces privados.',
        ]),
        ('Qué hicimos con eso', [
            '*Mejora aplicada: servir el build, no el servidor de desarrollo.',
            'El tiempo de respuesta bajó alrededor de un 20 %, confirmado dos veces.',
            'Se descartó otra idea: ahorraba poco y retrasaba el cierre de sesiones.',
        ]),
    ),
], y_abajo=214)

px, py, pw, ph = panel(MARGEN, 56, ANCHO - 2 * MARGEN, 150,
                       'La sorpresa: casi todo el tiempo se iba fuera del programa')
barra_proporciones(px, py + 8, pw, ph - 20, [
    ('Fuera de la aplicación: red del entorno de desarrollo', 73, ACENTO),
    ('PostgreSQL: dos consultas por petición', 20, colors.HexColor('#3f7ad4')),
    ('Nuestro código', 7, ACENTO2),
])
c.setFont('Texto', 8.6)
c.setFillColor(GRIS)
c.drawRightString(px + pw, py + 10, 'Sin medir, habríamos optimizado ese 7 %.')
pie(6)
c.showPage()

# ── 7. Seguridad, release y rollback ─────────────────────────────────────────
fondo()
encabezado(6, 'Seguridad, release y rollback',
           'Cómo se protege, cómo se publica una versión y cómo se deshace')
cuerpo(ALTO - 122, [
    (
        ('Qué se protege y cómo', [
            'Las contraseñas nunca se guardan tal cual, y la sesión va firmada: cambiarla revoca todas las anteriores.',
            'Los intentos fallidos se cuentan y se frenan; los permisos de una tarea compartida tienen tres niveles distintos.',
            '*Cada uno de esos controles tiene una prueba que lo vigila.',
        ]),
        ('Poner a prueba lo que no debe pasar', [
            'Se simulan diez intentos hostiles reales: manipular la tarea de otra persona, editar sin el permiso adecuado, reutilizar un enlace de invitación, colar un archivo ejecutable como si fuera imagen.',
            'Todos terminan rechazados, y así debe seguir siendo.',
        ]),
    ),
    (
        ('Qué es publicar una versión', [
            'No es solo subir código: la versión queda marcada con una etiqueta fija, acompañada de un documento que declara qué contiene y una lista de cambios y límites conocidos.',
            '*Cualquiera puede saber después qué se publicó exactamente.',
        ]),
        ('Si algo sale mal', [
            'Se vuelve a la versión anterior con un par de órdenes.',
            '*Con un cuidado importante: volver el código no deshace los cambios en la base de datos.',
            'Si los hubo, primero se restaura la copia de seguridad.',
        ]),
    ),
])
pie(7)
c.showPage()

# ── 8. Agradecimiento ────────────────────────────────────────────────────────
fondo()
c.setFillColor(ACENTO)
c.rect(0, ALTO - 6, ANCHO, 6, fill=1, stroke=0)

c.setFont('Negrita', 56)
c.setFillColor(BLANCO)
c.drawCentredString(ANCHO / 2, ALTO / 2 + 26, 'Gracias')

c.setStrokeColor(BORDE)
c.setLineWidth(0.8)
c.line(ANCHO / 2 - 160, ALTO / 2 - 16, ANCHO / 2 + 160, ALTO / 2 - 16)

c.setFont('Negrita', 13.5)
c.setFillColor(ACENTO2)
c.drawCentredString(ANCHO / 2, ALTO / 2 - 46, 'novatareas.polarzero.dev')
c.setFont('Mono', 10.5)
c.setFillColor(GRIS)
c.drawCentredString(ANCHO / 2, ALTO / 2 - 68, 'github.com/Saul1hdz/NovaTareas  ·  v1.0.0')

c.setFont('Texto', 10)
c.setFillColor(GRIS)
c.drawCentredString(ANCHO / 2, 66, 'Equipo 3  ·  Saúl López  ·  Moises Martínez  ·  Enson Carranza')
c.setFont('Texto', 9)
c.drawCentredString(ANCHO / 2, 48,
                    'Universidad Gerardo Barrios  ·  Módulo 4: Desarrollo de Aplicaciones con IA')
c.showPage()

c.save()
print('presentacion generada:', DESTINO)
