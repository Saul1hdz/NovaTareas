const PRIORITIES = new Set(['baja', 'media', 'alta', 'urgente']);
const STATUSES = new Set(['pendiente', 'en progreso', 'completada']);
const VISIBILITIES = new Set(['privada', 'colaborativa']);
const COMMENT_KINDS = new Set(['comentario', 'idea']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value, field, { required = false, max }) {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'string') return { error: `${field} debe ser texto` };

  const normalized = value.trim();
  if (required && !normalized) return { error: `${field} es obligatorio` };
  if (normalized.length > max) {
    return { error: `${field} no puede superar ${max} caracteres` };
  }
  return { value: normalized };
}

function date(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return { error: 'La fecha límite debe usar el formato YYYY-MM-DD' };
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { error: 'La fecha límite no es válida' };
  }
  return { value };
}

export function validateTaskInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'El cuerpo debe ser un objeto JSON' };
  }

  const values = {};
  const fields = [
    ['title', 'El título', { required: !partial, max: 200 }],
    ['description', 'La descripción', { max: 2000 }],
    ['label', 'La etiqueta', { max: 80 }],
    ['observations', 'Las observaciones', { max: 2000 }],
    ['what_worked', 'El campo qué funcionó', { max: 2000 }],
    ['what_failed', 'El campo qué falló', { max: 2000 }],
  ];

  for (const [key, label, options] of fields) {
    const result = text(body[key], label, options);
    if (result.error) return result;
    if (result.value !== undefined) values[key] = result.value;
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !PRIORITIES.has(body.priority)) {
      return { error: 'Prioridad inválida' };
    }
    values.priority = body.priority;
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
      return { error: 'Estado inválido' };
    }
    values.status = body.status;
  }

  if (body.visibility !== undefined) {
    if (typeof body.visibility !== 'string' || !VISIBILITIES.has(body.visibility)) {
      return { error: 'Visibilidad inválida' };
    }
    values.visibility = body.visibility;
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      return { error: 'Archivada debe ser un valor booleano' };
    }
    values.archived = body.archived;
  }

  const dueDate = date(body.due_date);
  if (dueDate.error) return dueDate;
  if (dueDate.value !== undefined) values.due_date = dueDate.value;

  // `reminder_at` es un instante con hora, a diferencia de `due_date`, que es
  // solo el día. Se acepta null explícito para desactivar el aviso.
  if (body.reminder_at !== undefined) {
    if (body.reminder_at === null || body.reminder_at === '') {
      values.reminder_at = null;
    } else if (typeof body.reminder_at !== 'string') {
      return { error: 'La fecha de recordatorio debe ser texto' };
    } else {
      const instant = new Date(body.reminder_at);
      if (Number.isNaN(instant.getTime())) {
        return { error: 'Fecha de recordatorio inválida' };
      }
      values.reminder_at = instant;
    }
  }

  return { values };
}

export function validateCommentInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'El cuerpo debe ser un objeto JSON' };
  }
  const comment = text(body.body, 'El comentario', { required: true, max: 2000 });
  if (comment.error) return comment;
  if (body.ask_ai !== undefined && typeof body.ask_ai !== 'boolean') {
    return { error: 'ask_ai debe ser un valor booleano' };
  }
  // En una tarea colaborativa no es lo mismo registrar un avance que proponer
  // una idea al equipo, así que el tipo viaja con el comentario.
  const kind = body.kind === undefined ? 'comentario' : body.kind;
  if (typeof kind !== 'string' || !COMMENT_KINDS.has(kind)) {
    return { error: 'Tipo de comentario inválido' };
  }
  return {
    values: { body: comment.value, ask_ai: body.ask_ai === true, kind },
  };
}
