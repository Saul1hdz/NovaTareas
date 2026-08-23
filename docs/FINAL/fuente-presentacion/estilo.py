# -*- coding: utf-8 -*-
"""Presentación final de NovaTareas Pro: 8 láminas horizontales (16:9).

Se dibuja con el lienzo directamente y no con platypus porque una lámina no es
un flujo de texto: cada elemento va donde se decide, no donde caiga. Las
tarjetas sí calculan su altura a partir de lo que llevan dentro, para que no
queden medio vacías.
"""
import sys
from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as lienzo_pdf

DESTINO = sys.argv[1]

# 16:9 — la proporción de cualquier proyector o pantalla actual.
ANCHO, ALTO = 960, 540
MARGEN = 54
HUECO = 20
ANCHO_COL = (ANCHO - 2 * MARGEN - HUECO) / 2

FUENTES = 'C:/Windows/Fonts/'
pdfmetrics.registerFont(TTFont('Texto', FUENTES + 'segoeui.ttf'))
pdfmetrics.registerFont(TTFont('Negrita', FUENTES + 'segoeuib.ttf'))
pdfmetrics.registerFont(TTFont('Ligera', FUENTES + 'segoeuil.ttf'))
pdfmetrics.registerFont(TTFont('Mono', FUENTES + 'consola.ttf'))

FONDO = colors.HexColor('#0e0e18')
FONDO2 = colors.HexColor('#171728')
ACENTO = colors.HexColor('#7c6af7')
ACENTO2 = colors.HexColor('#34d399')
BLANCO = colors.HexColor('#f2f1fa')
GRIS = colors.HexColor('#a5a2c4')
BORDE = colors.HexColor('#2b2b40')

CUERPO = 9.4
INTERLINEA = 14.0

c = lienzo_pdf.Canvas(DESTINO, pagesize=(ANCHO, ALTO))
c.setTitle('NovaTareas Pro — Presentación final')
c.setAuthor('Equipo 3 — Universidad Gerardo Barrios')


def envolver(texto, tam=CUERPO, ancho=ANCHO_COL - 42):
    return simpleSplit(texto, 'Texto', tam, ancho)


def fondo():
    c.setFillColor(FONDO)
    c.rect(0, 0, ANCHO, ALTO, fill=1, stroke=0)


def pie(numero):
    c.setStrokeColor(BORDE)
    c.setLineWidth(0.6)
    c.line(MARGEN, 38, ANCHO - MARGEN, 38)
    c.setFont('Texto', 8)
    c.setFillColor(GRIS)
    c.drawString(MARGEN, 23, 'NovaTareas Pro 1.0.0  ·  novatareas.polarzero.dev')
    c.drawRightString(ANCHO - MARGEN, 23, f'{numero} / 8')


def encabezado(numero, titulo, bajada):
    """Número al fondo, título grande y una línea que dice el enfoque."""
    c.setFont('Negrita', 44)
    c.setFillColor(colors.HexColor('#241f4d'))
    c.drawString(MARGEN, ALTO - 80, f'{numero:02d}')

    c.setFont('Negrita', 24)
    c.setFillColor(BLANCO)
    c.drawString(MARGEN + 68, ALTO - 68, titulo)

    c.setFont('Texto', 10.5)
    c.setFillColor(GRIS)
    c.drawString(MARGEN + 70, ALTO - 87, bajada)

    c.setStrokeColor(ACENTO)
    c.setLineWidth(2.5)
    c.line(MARGEN + 70, ALTO - 98, MARGEN + 140, ALTO - 98)


def alto_tarjeta(lineas, resalte=None):
    renglones = sum(len(envolver(l.lstrip('*'))) for l in lineas)
    return 48 + renglones * INTERLINEA + (26 if resalte else 12)


def tarjeta(x, y, alto, titulo, lineas, resalte=None):
    c.setFillColor(FONDO2)
    c.setStrokeColor(BORDE)
    c.setLineWidth(0.8)
    c.roundRect(x, y, ANCHO_COL, alto, 8, fill=1, stroke=1)

    c.setStrokeColor(ACENTO)
    c.setLineWidth(2.2)
    c.line(x + 15, y + alto - 12, x + 40, y + alto - 12)

    c.setFont('Negrita', 11.5)
    c.setFillColor(BLANCO)
    c.drawString(x + 15, y + alto - 31, titulo)

    cursor = y + alto - 50
    for linea in lineas:
        destacado = linea.startswith('*')
        for indice, trozo in enumerate(envolver(linea.lstrip('*'))):
            if indice == 0:
                c.setFillColor(ACENTO2 if destacado else ACENTO)
                c.circle(x + 19, cursor + 3.2, 1.8, fill=1, stroke=0)
            c.setFont('Negrita' if destacado else 'Texto', CUERPO)
            c.setFillColor(BLANCO if destacado else GRIS)
            c.drawString(x + 28, cursor, trozo)
            cursor -= INTERLINEA

    if resalte:
        c.setFont('Mono', 8.8)
        c.setFillColor(ACENTO2)
        c.drawString(x + 15, y + 13, resalte)


def _dibujar_fila(y, alto, izquierda, derecha):
    for indice, spec in enumerate((izquierda, derecha)):
        tarjeta(MARGEN + indice * (ANCHO_COL + HUECO), y, alto,
                spec[0], spec[1], spec[2] if len(spec) > 2 else None)


def cuerpo(y_arriba, filas, y_abajo=56):
    """Coloca una o dos filas repartiendo entre ellas el espacio sobrante.

    Sin este reparto las tarjetas conservan su altura mínima y la lámina queda
    con un hueco muerto abajo, que es justo lo que delata una diapositiva hecha
    con prisa.
    """
    naturales = [max(alto_tarjeta(t[1], t[2] if len(t) > 2 else None) for t in par)
                 for par in filas]
    disponible = y_arriba - y_abajo - HUECO * (len(filas) - 1)
    libre = max(0, disponible - sum(naturales))
    # Se reparte solo una parte del sobrante: estirar las tarjetas hasta llenar
    # deja un vacío raro debajo del texto. El resto se usa para centrar el
    # bloque, que respira mejor que una tarjeta hueca.
    sobrante = min(libre / len(filas), 34)
    y = y_arriba - (libre - sobrante * len(filas)) / 2
    for par, natural in zip(filas, naturales):
        alto = natural + sobrante
        y -= alto
        _dibujar_fila(y, alto, par[0], par[1])
        y -= HUECO
    return y


def cifras(y, datos):
    ancho = (ANCHO - 2 * MARGEN - 3 * 14) / 4
    for i, (valor, etiqueta) in enumerate(datos):
        x = MARGEN + i * (ancho + 14)
        c.setFillColor(FONDO2)
        c.setStrokeColor(BORDE)
        c.setLineWidth(0.8)
        c.roundRect(x, y, ancho, 62, 8, fill=1, stroke=1)
        c.setFont('Negrita', 23)
        c.setFillColor(ACENTO2)
        c.drawCentredString(x + ancho / 2, y + 30, valor)
        c.setFont('Texto', 8.4)
        c.setFillColor(GRIS)
        for j, linea in enumerate(simpleSplit(etiqueta, 'Texto', 8.4, ancho - 16)[:2]):
            c.drawCentredString(x + ancho / 2, y + 17 - j * 9.5, linea)
    return y




# ── Diagramas ────────────────────────────────────────────────────────────────
# Tres láminas se entienden mejor dibujadas que descritas. Estas funciones
# reciben el rectángulo donde deben caber y se encargan del resto.

def panel(x, y, ancho, alto, titulo=None):
    """Recuadro del mismo aspecto que las tarjetas, para alojar un diagrama."""
    c.setFillColor(FONDO2)
    c.setStrokeColor(BORDE)
    c.setLineWidth(0.8)
    c.roundRect(x, y, ancho, alto, 8, fill=1, stroke=1)
    if titulo:
        c.setStrokeColor(ACENTO)
        c.setLineWidth(2.2)
        c.line(x + 15, y + alto - 12, x + 40, y + alto - 12)
        c.setFont('Negrita', 11.5)
        c.setFillColor(BLANCO)
        c.drawString(x + 15, y + alto - 31, titulo)
    return x + 15, y + 12, ancho - 30, alto - (44 if titulo else 24)


def cascada(x, y, ancho, alto, escalones):
    """Escalones descendentes: cada uno entra si el anterior no responde."""
    n = len(escalones)
    hueco = 8
    alto_caja = (alto - hueco * (n - 1)) / n
    for i, (titulo, detalle) in enumerate(escalones):
        cy = y + alto - (i + 1) * alto_caja - i * hueco
        # El ancho decrece para que se lea como una degradación.
        w = ancho * (1 - i * 0.06)
        c.setFillColor(colors.HexColor('#1e1e33') if i else colors.HexColor('#241f4d'))
        c.setStrokeColor(ACENTO if i == 0 else BORDE)
        c.setLineWidth(1.2 if i == 0 else 0.8)
        c.roundRect(x, cy, w, alto_caja, 6, fill=1, stroke=1)

        c.setFont('Negrita', 9.6)
        c.setFillColor(BLANCO if i == 0 else GRIS)
        c.drawString(x + 12, cy + alto_caja / 2 - 3, titulo)
        c.setFont('Texto', 8.6)
        c.setFillColor(GRIS)
        c.drawRightString(x + w - 12, cy + alto_caja / 2 - 3, detalle)

        if i < n - 1:
            c.setFillColor(ACENTO2)
            c.setFont('Texto', 8)
            c.drawString(x + 6, cy - hueco + 1, '▼')


def flujo(x, y, ancho, alto, izquierda, derecha):
    """Dos cajas que convergen en una tercera: el pipeline de tres trabajos."""
    ancho_izq = ancho * 0.40
    ancho_der = ancho * 0.44
    hueco = 10
    alto_caja = (alto - hueco) / 2

    def caja(cx, cy, cw, ch, titulo, puntos, resaltada=False):
        c.setFillColor(colors.HexColor('#241f4d') if resaltada else colors.HexColor('#1e1e33'))
        c.setStrokeColor(ACENTO if resaltada else BORDE)
        c.setLineWidth(1.2 if resaltada else 0.8)
        c.roundRect(cx, cy, cw, ch, 6, fill=1, stroke=1)
        c.setFont('Negrita', 9.4)
        c.setFillColor(BLANCO)
        c.drawString(cx + 11, cy + ch - 17, titulo)
        c.setFont('Texto', 8.3)
        c.setFillColor(GRIS)
        cursor = cy + ch - 31
        for p in puntos:
            c.drawString(cx + 11, cursor, '· ' + p)
            cursor -= 11

    caja(x, y + alto_caja + hueco, ancho_izq, alto_caja, izquierda[0], izquierda[1])
    caja(x, y, ancho_izq, alto_caja, derecha[0], derecha[1])

    # Las dos convergen en la de la derecha.
    medio = x + ancho_izq
    destino = x + ancho - ancho_der
    c.setStrokeColor(ACENTO)
    c.setLineWidth(1.1)
    for cy in (y + alto_caja + hueco + alto_caja / 2, y + alto_caja / 2):
        c.line(medio, cy, medio + (destino - medio) / 2, cy)
    c.line(medio + (destino - medio) / 2, y + alto_caja / 2,
           medio + (destino - medio) / 2, y + alto_caja + hueco + alto_caja / 2)
    c.line(medio + (destino - medio) / 2, y + alto / 2, destino, y + alto / 2)
    c.setFillColor(ACENTO)
    c.drawString(destino - 7, y + alto / 2 - 3.5, '▶')
    c.setFont('Texto', 7.6)
    c.setFillColor(GRIS)
    c.drawCentredString(medio + (destino - medio) / 2, y + alto / 2 + 8, 'solo si ambos pasan')
    return destino, ancho_der


def barra_proporciones(x, y, ancho, alto, tramos):
    """Barra apilada con su leyenda: dónde se va el tiempo."""
    total = sum(t[1] for t in tramos)
    alto_barra = 26
    cursor = x
    for etiqueta, valor, color in tramos:
        w = ancho * valor / total
        c.setFillColor(color)
        c.rect(cursor, y + alto - alto_barra, w, alto_barra, fill=1, stroke=0)
        if w > 34:
            c.setFont('Negrita', 10)
            c.setFillColor(colors.white if color != ACENTO2 else colors.HexColor('#04231a'))
            c.drawCentredString(cursor + w / 2, y + alto - alto_barra + 9, f'{valor} %')
        cursor += w

    cursor_y = y + alto - alto_barra - 20
    for etiqueta, valor, color in tramos:
        c.setFillColor(color)
        c.circle(x + 5, cursor_y + 3, 4, fill=1, stroke=0)
        c.setFont('Texto', 9)
        c.setFillColor(GRIS)
        c.drawString(x + 16, cursor_y, etiqueta)
        cursor_y -= 15
