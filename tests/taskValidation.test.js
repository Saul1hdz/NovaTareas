import { describe, expect, it } from 'vitest';
import {
  validateCommentInput,
  validateTaskInput,
} from '../src/lib/taskValidation.js';

describe('validación de tareas y comentarios', () => {
  it('acepta texto que debe mostrarse literalmente y lo limita por tamaño', () => {
    const result = validateTaskInput({
      title: 'Prueba <script>alert(1)</script>',
      description: '"comillas" y `backticks`',
      label: "universidad 'demo'",
      priority: 'alta',
      due_date: '2026-08-01',
    });

    expect(result.error).toBeUndefined();
    expect(result.values.title).toContain('<script>');
    expect(validateTaskInput({ title: 'x'.repeat(201) }).error).toContain('200');
  });

  it('rechaza valores que podrían alterar clases o estados del dashboard', () => {
    expect(validateTaskInput({
      title: 'Tarea',
      priority: 'media" onclick="alert(1)',
    }).error).toBe('Prioridad inválida');

    expect(validateTaskInput({
      status: 'completada<script>',
    }, { partial: true }).error).toBe('Estado inválido');
  });

  it('valida fechas reales y comentarios acotados', () => {
    expect(validateTaskInput({
      title: 'Tarea',
      due_date: '2026-02-30',
    }).error).toBe('La fecha límite no es válida');
    expect(validateCommentInput({ body: 'x'.repeat(2001) }).error).toContain('2000');
    expect(validateCommentInput({ body: 'avance ficticio', ask_ai: true }).values)
      .toEqual({ body: 'avance ficticio', ask_ai: true, kind: 'comentario' });
  });
});
