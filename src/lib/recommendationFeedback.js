/**
 * Consultas sobre las valoraciones de recomendaciones.
 *
 * Viven en una librería y no en el endpoint porque las usan tanto el botón de
 * consejos como el de utilidad, y tenerlas en uno de los dos endpoints obligaba
 * a que se importaran entre sí.
 */

/**
 * Valoraciones que se le pasan a la IA al regenerar. Se limitan a las últimas:
 * el prompt tiene presupuesto y lo reciente describe mejor lo que la persona
 * quiere ahora.
 */
export async function feedbackForPrompt(db, taskId, userId, limite = 3) {
  return db.prepare(`
    SELECT f.useful, f.comment, r.recommendation
    FROM recommendation_feedback f
    JOIN task_recommendations r ON r.id = f.recommendation_id
    WHERE f.task_id = $1 AND f.user_id = $2
    ORDER BY f.updated_at DESC
    LIMIT $3
  `).all(taskId, userId, limite);
}

/**
 * Lo que el usuario aprendió sobre los consejos de sus tareas ya archivadas.
 *
 * Es la parte que sobrevive a la tarea: cuando se archiva, la valoración se
 * queda y sirve de contexto para tareas parecidas en el futuro. Solo se traen
 * las que llevan explicación, porque un pulgar suelto no le dice nada a la IA.
 */
export async function archivedFeedbackContext(db, userId, limite = 5) {
  return db.prepare(`
    SELECT t.title AS task_title, f.useful, f.comment, r.recommendation
    FROM recommendation_feedback f
    JOIN tasks t ON t.id = f.task_id
    JOIN task_recommendations r ON r.id = f.recommendation_id
    WHERE f.user_id = $1 AND t.archived AND btrim(f.comment) <> ''
    ORDER BY f.updated_at DESC
    LIMIT $2
  `).all(userId, limite);
}
