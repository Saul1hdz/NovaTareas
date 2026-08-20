import { describe, expect, it, vi } from 'vitest';
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
  trackDuration,
} from '../src/lib/observability.js';

describe('normalización de rutas', () => {
  it('sustituye identificadores numéricos por su plantilla', () => {
    expect(normalizeRoute('/api/tasks/42/comments')).toBe('/api/tasks/:id/comments');
    expect(normalizeRoute('/api/tasks/7/subtasks/13')).toBe('/api/tasks/:id/subtasks/:id');
    expect(normalizeRoute('/api/v1/recommend')).toBe('/api/v1/recommend');
  });

  it('no deja tokens largos en el log', () => {
    // Un enlace de invitación o un código es una credencial: agrupar la ruta
    // evita publicarlo en un evento que acaba en un PDF de evidencias.
    const route = normalizeRoute('/unirse/uUCgyZIlS8Y1OIqlJt_X0DFaeyeLIH65');
    expect(route).toBe('/unirse/:token');
    expect(route).not.toContain('uUCgyZ');
  });

  it('descarta rutas de recursos estáticos', () => {
    expect(shouldLogPath('/api/tasks')).toBe(true);
    expect(shouldLogPath('/_astro/index.abc123.js')).toBe(false);
    expect(shouldLogPath('/avatars/usuario-1.png')).toBe(false);
  });
});

describe('clasificación del resultado', () => {
  it('distingue éxito, error del cliente y error del servidor', () => {
    expect(outcomeFor(200)).toBe('success');
    expect(outcomeFor(201)).toBe('success');
    expect(outcomeFor(400)).toBe('client_error');
    expect(outcomeFor(429)).toBe('client_error');
    expect(outcomeFor(500)).toBe('server_error');
  });

  it('publica la clase del error pero nunca su mensaje', () => {
    const error = new TypeError('la contraseña secreta123 no coincide');
    expect(errorTypeOf(error)).toBe('TypeError');

    const withCode = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
      name: '',
      code: 'ECONNREFUSED',
    });
    expect(errorTypeOf(withCode)).toBe('ECONNREFUSED');
    expect(errorTypeOf({})).toBe('UnknownError');
  });
});

describe('identificador de solicitud', () => {
  it('acepta un identificador entrante con forma inofensiva', () => {
    expect(resolveRequestId('abc123-def456')).toBe('abc123-def456');
  });

  it('genera uno propio cuando el entrante es inválido o peligroso', () => {
    // Cabecera de terceros: si se aceptara tal cual, quien llama podría inyectar
    // saltos de línea y fabricar eventos falsos en el log.
    const injected = resolveRequestId('abc\n{"event":"http_request","status":200}');
    expect(injected).not.toContain('\n');
    expect(injected).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('corto')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('contexto de la solicitud', () => {
  it('anota solo los campos permitidos', async () => {
    await runWithRequestContext({ request_id: 'req-1' }, async () => {
      annotate({ ai_source: 'rules', error_type: 'validacion_entrada' });
      // `status` lo fija el middleware: una ruta no debe poder falsearlo.
      annotate({ status: 200, password: 'Clave1234' });

      const context = currentContext();
      expect(context.ai_source).toBe('rules');
      expect(context.error_type).toBe('validacion_entrada');
      expect(context.status).toBeUndefined();
      expect(context.password).toBeUndefined();
    });
  });

  it('anotar fuera de una solicitud no rompe ni cambia nada', () => {
    expect(() => annotate({ ai_source: 'zai' })).not.toThrow();
    expect(currentContext()).toBeNull();
  });

  it('mide la duración de una operación', async () => {
    await runWithRequestContext({ request_id: 'req-2' }, async () => {
      await trackDuration('ai_duration_ms', async () => {
        await new Promise(resolve => setTimeout(resolve, 12));
      });
      expect(currentContext().ai_duration_ms).toBeGreaterThanOrEqual(10);
    });
  });
});

describe('evento publicado', () => {
  function captureLine(fields) {
    const written = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(line => {
      written.push(line);
      return true;
    });
    try {
      logRequestEvent(fields);
    } finally {
      spy.mockRestore();
    }
    return written.join('');
  }

  it('emite una única línea JSON con los campos del contrato', () => {
    const line = captureLine({
      level: 'info',
      request_id: 'req-3',
      method: 'POST',
      route: '/api/v1/recommend',
      status: 200,
      outcome: 'success',
      duration_ms: 41,
      ai_source: 'rules',
      ai_prompt_version: 'recommend-v1',
    });

    expect(line.trimEnd().split('\n')).toHaveLength(1);
    const event = JSON.parse(line);
    expect(event).toMatchObject({
      event: 'http_request',
      request_id: 'req-3',
      route: '/api/v1/recommend',
      status: 200,
      outcome: 'success',
      ai_source: 'rules',
    });
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('descarta cualquier campo fuera de la lista blanca', () => {
    // La garantía de privacidad no depende de que quien llama recuerde filtrar:
    // lo que no está en el contrato no se publica, venga de donde venga.
    const event = JSON.parse(captureLine({
      level: 'info',
      request_id: 'req-4',
      method: 'POST',
      route: '/api/login',
      status: 200,
      outcome: 'success',
      duration_ms: 10,
      authorization: 'Bearer token-secreto',
      password: 'Clave1234',
      email: 'ana@example.test',
      body: { titulo: 'Tarea privada del usuario' },
      cookie: 'novatareas_token=abc',
    }));

    expect(event.authorization).toBeUndefined();
    expect(event.password).toBeUndefined();
    expect(event.email).toBeUndefined();
    expect(event.body).toBeUndefined();
    expect(event.cookie).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('token-secreto');
    expect(JSON.stringify(event)).not.toContain('Clave1234');
  });
});
