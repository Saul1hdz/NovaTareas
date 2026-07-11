import { getDb } from '../src/lib/db.js';
const db = getDb();
const rows = db.prepare(`SELECT t.id, t.user_id, t.title, t.description, t.priority, t.status, t.label, t.due_date, t.created_at, t.completed_at,
  GROUP_CONCAT(s.id || '::' || s.text || '::' || s.done, '||') AS subtasks_raw
  FROM tasks t
  LEFT JOIN subtasks s ON s.task_id = t.id
  GROUP BY t.id
  ORDER BY t.created_at DESC
`).all();
console.log(JSON.stringify(rows, null, 2));
