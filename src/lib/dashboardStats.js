import { dateInAppTimeZone } from './appTime.js';

/**
 * Métricas y etiquetas que el dashboard muestra en su cabecera.
 *
 * Vivía en el front-matter de dashboard.astro, donde no se podía probar: era el
 * único sitio donde el `COUNT(*)` de PostgreSQL (BIGINT) se usaba en aritmética,
 * y donde "hoy" se calculaba en UTC en lugar de la zona de la aplicación.
 */
export async function getDashboardStats(db, userId, today = dateInAppTimeZone()) {
  const [totalRow, doneRow, urgentRow, overdueRow, labelRows] = await Promise.all([
    db.prepare(
      'SELECT COUNT(*) as c FROM tasks WHERE user_id=$1 AND NOT archived'
    ).get(userId),

    db.prepare(
      `SELECT COUNT(*) as c FROM tasks
       WHERE user_id=$1 AND NOT archived AND status='completada'`
    ).get(userId),

    db.prepare(
      `SELECT COUNT(*) as c FROM tasks
       WHERE user_id=$1 AND NOT archived AND priority='urgente'
         AND status!='completada'`
    ).get(userId),

    db.prepare(
      `SELECT COUNT(*) as c FROM tasks
       WHERE user_id=$1 AND NOT archived AND status!='completada'
         AND due_date IS NOT NULL AND due_date < $2`
    ).get(userId, today),

    db.prepare(
      `SELECT DISTINCT label FROM tasks
       WHERE user_id=$1 AND label!='' AND NOT archived
       ORDER BY label`
    ).all(userId),
  ]);

  const total = Number(totalRow.c);
  const done = Number(doneRow.c);

  return {
    total,
    done,
    active: total - done,
    urgent: Number(urgentRow.c),
    overdue: Number(overdueRow.c),
    labels: labelRows.map(row => row.label),
  };
}
