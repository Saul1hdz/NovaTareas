import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { closeDb, getDb, withTransaction } from '../src/lib/db.js';

/**
 * Crea usuarios y tareas ficticios reproducibles para una demostración.
 *
 * Todos los datos son inventados. El script es idempotente: si las cuentas ya
 * existen no hace nada, así que puede ejecutarse tras cada despliegue.
 *
 *   node scripts/seed-demo.mjs
 *   SEED_RESET=1 node scripts/seed-demo.mjs   # recrea las cuentas de demo
 */

const PASSWORD = process.env.SEED_PASSWORD || 'DemoNova2026';

const USERS = [
  {
    email: 'ana.demo@example.test',
    fullName: 'Ana Demo',
    userType: 'estudiante',
    telefono: '+50370000001',
    tasks: [
      { title: 'Preparar examen de Bases de Datos', priority: 'urgente', label: 'estudio', dueInDays: 2,
        description: 'Repasar normalización, transacciones e índices.' },
      { title: 'Entregar informe de laboratorio', priority: 'alta', label: 'estudio', dueInDays: 5 },
      { title: 'Leer capítulo 4 de Redes', priority: 'media', label: 'estudio', dueInDays: 9 },
      { title: 'Inscribir materias del próximo ciclo', priority: 'baja', label: 'trámites', dueInDays: -3 },
    ],
  },
  {
    email: 'beto.demo@example.test',
    fullName: 'Beto Demo',
    userType: 'empleado',
    telefono: '+50370000002',
    tasks: [
      { title: 'Cerrar reporte mensual', priority: 'alta', label: 'trabajo', dueInDays: 1 },
      { title: 'Revisar solicitudes del equipo', priority: 'media', label: 'trabajo', dueInDays: 4 },
      { title: 'Actualizar documentación del proceso', priority: 'baja', label: 'trabajo', dueInDays: 14 },
    ],
  },
  {
    email: 'carla.demo@example.test',
    fullName: 'Carla Demo',
    userType: 'comun',
    telefono: '+50370000003',
    tasks: [
      { title: 'Renovar la licencia de conducir', priority: 'media', label: 'personal', dueInDays: 7 },
      { title: 'Agendar revisión médica anual', priority: 'baja', label: 'salud', dueInDays: 21 },
    ],
  },
];

function isoDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function seedUser(tx, user, passwordHash, answerHash) {
  const created = await tx.prepare(`
    INSERT INTO users (username, full_name, email, password_hash, telefono, user_type)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `).get(user.fullName, user.fullName, user.email, passwordHash, user.telefono, user.userType);

  await tx.prepare(`
    INSERT INTO security_questions (user_id, q1_index, q1_answer, q2_index, q2_answer)
    VALUES ($1, 0, $2, 1, $3)
  `).run(created.id, answerHash, answerHash);

  for (const task of user.tasks) {
    await tx.prepare(`
      INSERT INTO tasks (user_id, title, description, priority, label, due_date)
      VALUES ($1, $2, $3, $4, $5, $6)
    `).run(
      created.id,
      task.title,
      task.description || '',
      task.priority,
      task.label,
      isoDate(task.dueInDays),
    );
  }

  return user.tasks.length;
}

const db = getDb();

try {
  const emails = USERS.map(user => user.email);

  if (process.env.SEED_RESET === '1') {
    const removed = await db.prepare(
      'DELETE FROM users WHERE email = ANY($1)'
    ).run(emails);
    console.log(`Cuentas de demo eliminadas: ${removed.rowCount}`);
  }

  const existing = await db.prepare(
    'SELECT email FROM users WHERE email = ANY($1)'
  ).all(emails);

  if (existing.length > 0) {
    console.log(
      `Ya existen ${existing.length} cuentas de demo; no se cambió nada.\n` +
      'Usa SEED_RESET=1 para recrearlas.'
    );
  } else {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const answerHash = await bcrypt.hash('demo', 10);

    let tasks = 0;
    await withTransaction(async (tx) => {
      for (const user of USERS) {
        tasks += await seedUser(tx, user, passwordHash, answerHash);
      }
    }, db);

    console.log(`Creadas ${USERS.length} cuentas ficticias y ${tasks} tareas.`);
    console.log(`Contraseña de todas: ${PASSWORD}`);
    console.log('Respuesta de ambas preguntas de seguridad: demo');
  }
} finally {
  await closeDb();
}
