/**
 * Normaliza un identificador que llega en la ruta.
 *
 * Las claves primarias son `integer` en PostgreSQL: pasar un valor no numérico
 * provoca el error 22P02 y una respuesta 500. Devolviendo null se conserva el
 * 404 que la aplicación daba antes, cuando la consulta simplemente no
 * encontraba filas.
 */
export function parseId(value) {
  return /^\d+$/.test(String(value ?? '')) ? Number(value) : null;
}
