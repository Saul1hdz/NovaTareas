import { describe, expect, it } from 'vitest';
import { crossSiteRejection } from '../src/lib/csrf.js';

function mutation({ url, origin, forwardedProto }) {
  const headers = {
    'Content-Type': 'application/json',
    Cookie: 'novatareas_token=sesion-prueba',
    Origin: origin,
  };
  if (forwardedProto) headers['X-Forwarded-Proto'] = forwardedProto;

  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Prueba' }),
  });
}

describe('protección CSRF detrás de proxy HTTPS', () => {
  it('acepta el origen HTTPS público cuando el proxy declara HTTPS', () => {
    const request = mutation({
      url: 'http://novatareas.polarzero.dev/api/tasks',
      origin: 'https://novatareas.polarzero.dev',
      forwardedProto: 'https',
    });

    expect(crossSiteRejection(request, request.url)).toBeNull();
  });

  it('sigue rechazando un origen ajeno aunque el proxy declare HTTPS', () => {
    const request = mutation({
      url: 'http://novatareas.polarzero.dev/api/tasks',
      origin: 'https://atacante.example',
      forwardedProto: 'https',
    });

    expect(crossSiteRejection(request, request.url)).toBe('origen_cruzado');
  });
});
