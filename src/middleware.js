import { defineMiddleware } from 'astro:middleware';
import { crossSiteRejection, crossSiteResponse } from './lib/csrf.js';

/**
 * Punto único donde se rechazan las mutaciones de origen cruzado.
 *
 * Vive aquí y no en cada endpoint porque una ruta nueva no puede olvidarse de
 * aplicarlo: toda petición pasa por el middleware. La lógica está en
 * `src/lib/csrf.js`, que además es lo que prueban los tests.
 */
export const onRequest = defineMiddleware((context, next) => {
  const motivo = crossSiteRejection(context.request, context.request.url);
  if (motivo) return crossSiteResponse(motivo);
  return next();
});
