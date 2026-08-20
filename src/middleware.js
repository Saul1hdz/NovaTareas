import { defineMiddleware, sequence } from 'astro:middleware';
import { crossSiteRejection, crossSiteResponse } from './lib/csrf.js';
import {
  annotate,
  currentContext,
  errorTypeOf,
  logRequestEvent,
  normalizeRoute,
  outcomeFor,
  resolveRequestId,
  runWithRequestContext,
  shouldLogPath,
} from './lib/observability.js';

/**
 * Instrumentación de todas las solicitudes.
 *
 * Vive en el middleware y no en cada endpoint por dos motivos: ninguna ruta
 * puede olvidarse de registrar su evento, y el `request_id` queda disponible
 * para el resto del código —vía AsyncLocalStorage— sin pasarlo por parámetros.
 *
 * El middleware no lee ni el cuerpo ni las cabeceras de la solicitud. Solo
 * necesita método, ruta, resultado y tiempo, así que no hay forma de que una
 * contraseña o un token acaben en el log por este camino.
 */
const observabilidad = defineMiddleware(async (context, next) => {
  const { request } = context;
  const pathname = new URL(request.url).pathname;

  if (!shouldLogPath(pathname)) return next();

  const requestId = resolveRequestId(request.headers.get('x-request-id'));
  const startedAt = performance.now();

  return runWithRequestContext({ request_id: requestId }, async () => {
    let response;
    let thrown = null;

    try {
      response = await next();
    } catch (error) {
      // Un error no capturado por la ruta: se registra con su clase y se deja
      // propagar para que Astro responda 500 como haría normalmente.
      thrown = error;
    }

    const status = thrown ? 500 : response.status;
    const duration = Math.round(performance.now() - startedAt);
    if (thrown) annotate({ error_type: errorTypeOf(thrown) });

    // Lo que las rutas hayan anotado durante la solicitud (componente de IA,
    // tipo de error, consultas) viaja en el contexto y se vuelca aquí.
    logRequestEvent({
      ...currentContext(),
      level: status >= 500 ? 'error' : 'info',
      request_id: requestId,
      method: request.method,
      route: normalizeRoute(pathname),
      status,
      outcome: outcomeFor(status),
      duration_ms: duration,
    });

    if (thrown) throw thrown;

    // Devolver el identificador permite que quien reporta un fallo —o el script
    // de medición— cite la línea exacta del log sin buscar por hora.
    response.headers.set('x-request-id', requestId);
    return response;
  });
});

/**
 * Punto único donde se rechazan las mutaciones de origen cruzado.
 *
 * Vive aquí y no en cada endpoint porque una ruta nueva no puede olvidarse de
 * aplicarlo: toda petición pasa por el middleware. La lógica está en
 * `src/lib/csrf.js`, que además es lo que prueban los tests.
 */
const proteccionCsrf = defineMiddleware((context, next) => {
  const motivo = crossSiteRejection(context.request, context.request.url);
  if (motivo) return crossSiteResponse(motivo);
  return next();
});

/**
 * La observabilidad va por fuera y el CSRF por dentro, no al revés: así un
 * rechazo por origen cruzado también deja su línea en el log, con su `403` y su
 * duración. Si el orden se invirtiera, los intentos bloqueados serían justo los
 * que no se podrían auditar.
 */
export const onRequest = sequence(observabilidad, proteccionCsrf);
