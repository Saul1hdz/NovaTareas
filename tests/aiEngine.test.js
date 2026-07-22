import { describe, it, expect } from 'vitest';
import { validateTaskInput, AI_META } from '../src/lib/aiEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de la capa de validación.
// No tocan la red ni la base de datos, por lo que siempre pueden ejecutarse
// en CI sin credenciales ni servicios externos.
// ─────────────────────────────────────────────────────────────────────────────

describe('validateTaskInput — entradas válidas', () => {
  it('acepta una tarea con solo el título', () => {
    const res = validateTaskInput({ titulo: 'Comprar leche' });
    expect(res.ok).toBe(true);
    expect(res.value.title).toBe('Comprar leche');
  });

  it('aplica los valores por defecto de prioridad y tipo de usuario', () => {
    const res = validateTaskInput({ titulo: 'Tarea sin extras' });
    expect(res.value.priority).toBe('media');
    expect(res.value.userType).toBe('comun');
  });

  it('normaliza la prioridad a minúsculas', () => {
    const res = validateTaskInput({ titulo: 'Informe', prioridad: 'ALTA' });
    expect(res.ok).toBe(true);
    expect(res.value.priority).toBe('alta');
  });

  it('recorta los espacios sobrantes del título', () => {
    const res = validateTaskInput({ titulo: '   Estudiar   ' });
    expect(res.value.title).toBe('Estudiar');
  });

  it('acepta una fecha límite con formato válido', () => {
    const res = validateTaskInput({ titulo: 'Entregar informe', fecha_limite: '2026-07-20' });
    expect(res.ok).toBe(true);
    expect(res.value.dueDate).toBe('2026-07-20');
  });
});

describe('validateTaskInput — entradas inválidas', () => {
  it('rechaza cuando falta el título', () => {
    const res = validateTaskInput({ prioridad: 'alta' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/titulo/i);
  });

  it('rechaza un título vacío o de solo espacios', () => {
    expect(validateTaskInput({ titulo: '' }).ok).toBe(false);
    expect(validateTaskInput({ titulo: '     ' }).ok).toBe(false);
  });

  it('rechaza un título que supera los 200 caracteres', () => {
    const res = validateTaskInput({ titulo: 'a'.repeat(201) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/200/);
  });

  it('rechaza una descripción que supera los 1000 caracteres', () => {
    const res = validateTaskInput({ titulo: 'Tarea', descripcion: 'x'.repeat(1001) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/1000/);
  });

  it('rechaza una prioridad fuera de los valores permitidos', () => {
    const res = validateTaskInput({ titulo: 'Tarea', prioridad: 'altisima' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/baja, media, alta, urgente/);
  });

  it('rechaza una fecha límite con formato inválido', () => {
    const res = validateTaskInput({ titulo: 'Tarea', fecha_limite: 'no-es-fecha' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/fecha/i);
  });

  it('rechaza un cuerpo que no es un objeto', () => {
    expect(validateTaskInput(null).ok).toBe(false);
    expect(validateTaskInput('texto plano').ok).toBe(false);
  });

  it('ignora un tipo de usuario desconocido y usa el valor por defecto', () => {
    // A diferencia de la prioridad, un tipo de usuario inválido no rompe
    // la petición: simplemente cae al perfil "comun".
    const res = validateTaskInput({ titulo: 'Tarea', tipo_usuario: 'astronauta' });
    expect(res.ok).toBe(true);
    expect(res.value.userType).toBe('comun');
  });
});

describe('AI_META', () => {
  it('expone la información mínima del servicio', () => {
    expect(AI_META.service).toBe('novatareas-ai');
    expect(AI_META.version).toBeDefined();
    expect(AI_META.primary_model).toBeDefined();
  });
});
