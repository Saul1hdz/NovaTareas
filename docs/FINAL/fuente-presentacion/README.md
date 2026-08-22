# Fuente editable de la presentación y del informe

Los PDF de esta carpeta no se maquetaron a mano: se generan desde estos
archivos. Editar aquí y volver a ejecutar es la forma de mantenerlos, porque un
PDF corregido a mano se desincroniza del contenido a la primera.

## Presentación

| Archivo | Qué contiene |
|---|---|
| `laminas.py` | El **contenido** de las ocho láminas: títulos, viñetas y su orden |
| `estilo.py` | El **aspecto**: lienzo 16:9, paleta, tipografías y primitivas de dibujo |

Separarlos permite cambiar el texto sin tocar el diseño, y al revés.

```bash
cd docs/FINAL/fuente-presentacion
python laminas.py ../presentacion-final.pdf
```

Para cambiar una lámina se edita su bloque en `laminas.py`. Cada tarjeta es una
tupla de `(título, [viñetas], resalte opcional)`. Dos detalles que ahorran
sorpresas:

- Una viñeta que empieza por `*` se pinta en negrita: es para la idea principal
  de la tarjeta, no para repartir énfasis por todas partes.
- **Cada elemento de la lista es una viñeta completa.** Partir una frase en dos
  entradas produce dos puntos donde debería haber uno; el ajuste de línea lo
  hace el propio programa.

Las tarjetas calculan su altura según lo que llevan dentro, así que añadir o
quitar viñetas no descoloca la lámina.

## Informe

`informe_a_documentos.py` convierte `informe-final.md` en el PDF y en el Word
editable, desde un mismo análisis del Markdown, para que los dos digan lo mismo
en el mismo orden.

```bash
cd docs/FINAL
python fuente-presentacion/informe_a_documentos.py informe-final.md
```

> **Cuidado**: sobrescribe `informe-final.docx`. Si alguien retocó ese Word a
> mano, esos cambios se pierden. La fuente de verdad es el Markdown.

En el PDF los emoji se sustituyen por su significado en texto (`[OK]`,
`[Parcial]`, `[Pendiente]`) porque las tipografías del documento no los
incluyen y saldrían como recuadros vacíos. En el Word y en el Markdown se
conservan.

## Requisitos

```bash
pip install reportlab python-docx
```

Las tipografías se toman de las que trae Windows: Segoe UI para el texto y
Consolas para el código. En otro sistema hay que apuntar `FUENTES`, en
`estilo.py`, a tipografías equivalentes.
