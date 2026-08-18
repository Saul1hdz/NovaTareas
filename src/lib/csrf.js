/**
 * Protección CSRF de las mutaciones autenticadas por cookie.
 *
 * Astro trae un chequeo de origen activado por defecto, pero solo rechaza las
 * peticiones «de formulario»: `application/x-www-form-urlencoded`,
 * `multipart/form-data`, `text/plain` y las que no declaran `content-type`.
 * Una petición ajena con `Content-Type: application/json` **sí** llega al
 * endpoint. Hoy un navegador no puede fabricarla contra otro origen —ese tipo
 * de contenido obliga a un preflight de CORS que este servidor no aprueba—,
 * así que en la práctica no es explotable desde el navegador.
 *
 * Aun así el control queda apoyado en un comportamiento del navegador y en un
 * valor por defecto del framework, ninguno declarado en este repositorio. Esta
 * comprobación lo vuelve explícito y fail-closed: si una mutación viaja con la
 * cookie de sesión, tiene que demostrar que salió de nuestro propio origen.
 *
 * Solo se aplica a peticiones con cookie de sesión. Las que se autentican con
 * `Authorization: Bearer` —la API pública, el script de medición, el webhook de
 * Telegram— no son falsificables desde el navegador de una víctima, porque el
 * navegador no adjunta esa cabecera sola.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_COOKIE_NAME = 'novatareas_token';

export function isSafeMethod(method) {
  return SAFE_METHODS.has(String(method || '').toUpperCase());
}

export function carriesSessionCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  return new RegExp(`(?:^|;\s*)${SESSION_COOKIE_NAME}=`).test(cookie);
}

/** Origen declarado por la petición: `Origin` y, si falta, el de `Referer`. */
export function declaredOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin;

  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Origen efectivo visto por el usuario.
 *
 * El adaptador Node recibe HTTP desde el reverse proxy aunque el navegador use
 * HTTPS. Caddy conserva el Host público y declara el esquema original en
 * X-Forwarded-Proto; sin reconstruirlo, una petición legítima parece cruzada.
 * Solo se aceptan los dos esquemas web y el primer valor de la cadena. El proxy
 * de producción debe sobrescribir esta cabecera y el puerto de la app debe
 * permanecer privado.
 */
export function effectiveRequestOrigin(request, requestUrl) {
  const url = new URL(requestUrl);
  const forwardedProto = (request.headers.get('x-forwarded-proto') || '')
    .split(',', 1)[0]
    .trim()
    .toLowerCase();

  if (forwardedProto === 'http' || forwardedProto === 'https') {
    url.protocol = `${forwardedProto}:`;
  }
  return url.origin;
}

/**
 * Decide si una petición debe rechazarse por origen cruzado.
 * Devuelve el motivo, o null cuando puede continuar.
 */
export function crossSiteRejection(request, requestUrl) {
  if (isSafeMethod(request.method)) return null;
  if (!carriesSessionCookie(request)) return null;

  const origen = declaredOrigin(request);
  // Fail-closed: sin origen declarado no se puede comprobar nada, y un
  // navegador siempre lo envía en una mutación. Aceptarlo «por si acaso» es
  // justamente el agujero que este control cierra.
  if (!origen) return 'origen_ausente';
  if (origen !== effectiveRequestOrigin(request, requestUrl)) return 'origen_cruzado';
  return null;
}

export function crossSiteResponse(motivo) {
  return new Response(
    JSON.stringify({
      error: motivo === 'origen_ausente'
        ? 'Petición sin origen declarado. Usa la aplicación desde su propia dirección.'
        : 'Petición de origen cruzado rechazada.',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}
