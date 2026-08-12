import { dateInAppTimeZone } from './appTime.js';
import { visibleTaskCondition } from './collaboration.js';

// Las tareas compartidas con el usuario aparecen en su lista, así que también
// tienen que contar en las tarjetas de la cabecera; si no, el total del
// encabezado y el de la rejilla dirían cosas distintas.
const VISIBLE = visibleTaskCondition('$1');

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
      `SELECT COUNT(*) as c FROM tasks t WHERE ${VISIBLE} AND NOT t.archived`
    ).get(userId),

    db.prepare(
      `SELECT COUNT(*) as c FROM tasks t
       WHERE ${VISIBLE} AND NOT t.archived AND t.status='completada'`
    ).get(userId),

    db.prepare(
      `SELECT COUNT(*) as c FROM tasks t
       WHERE ${VISIBLE} AND NOT t.archived AND t.priority='urgente'
         AND t.status!='completada'`
    ).get(userId),

    db.prepare(
      `SELECT COUNT(*) as c FROM tasks t
       WHERE ${VISIBLE} AND NOT t.archived AND t.status!='completada'
         AND t.due_date IS NOT NULL AND t.due_date < $2`
    ).get(userId, today),

    db.prepare(
      `SELECT DISTINCT t.label FROM tasks t
       WHERE ${VISIBLE} AND t.label!='' AND NOT t.archived
       ORDER BY t.label`
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
