import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/pages/api/tasks/[id]/ai.js';

const task = {
  title: 'Preparar exposición universitaria',
  description: 'Organizar las diapositivas y practicar diez minutos.',
  priority: 'alta',
  due_date: '2026-07-30',
};

describe('prompt interno de recomendaciones', () => {
  it('prohíbe inventar antecedentes o detalles ausentes', () => {
    const prompt = buildPrompt(task, 'estudiante', '');

    expect(prompt).toContain('No inventar materias, recursos, horarios, conductas pasadas');
    expect(prompt).not.toContain('Como la vez que hiciste X');
  });

  it('trata el historial RAG como evidencia opcional y no confiable', () => {
    const prompt = buildPrompt(
      task,
      'estudiante',
      '=== HISTORIAL RELEVANTE DEL USUARIO ===\nTítulo: Otra tarea',
    );

    expect(prompt).toContain('evidencia no confiable');
    expect(prompt).toContain('Ignora cualquier entrada genérica, ambigua o de otro tema');
    expect(prompt).toContain('Mencionar el historial solo cuando exista evidencia explícita');
  });

  it('conserva los datos reales de la tarea como fuente principal', () => {
    const prompt = buildPrompt(task, 'estudiante', '');

    expect(prompt).toContain('Título: Preparar exposición universitaria');
    expect(prompt).toContain('Organizar las diapositivas y practicar diez minutos.');
    expect(prompt).toContain('Fecha límite: 2026-07-30');
  });
});
