import {
  db,
  getUserByTelegramChatId,
  linkTelegram,
  getTasksByUser,
  getCategoriesByUser,
  getUsersWithDueTasks,
  markReminderSent,
} from './db.js';
import { consumeTelegramLinkCode } from './telegramLink.js';
import { consumeRateLimit, resetRateLimit, safeErrorSummary } from './security.js';
import { validateTaskInput } from './taskValidation.js';

const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE       = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ZAI_API_KEY  = process.env.ZAI_API_KEY?.trim();
const ZAI_URL       = 'https://api.z.ai/api/paas/v4/chat/completions';
const ZAI_MODEL     = process.env.ZAI_MODEL || 'glm-4.5-flash';
const OLLAMA_URL     = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// ─── Estado de conversación en memoria ───────────────────────────────────────
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: null, data: {} });
  return sessions.get(chatId);
}

function clearSession(chatId) {
  sessions.delete(chatId);
}

function displayName(user) {
  return user?.full_name || user?.username || 'Usuario';
}

function escapeTelegramHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Convierte Markdown de Gemini a HTML de Telegram
function mdToHtml(text) {
  return escapeTelegramHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/#{1,3} (.*)/g, '<b>$1</b>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

// ─── API de Telegram ──────────────────────────────────────────────────────────

export async function sendMessage(chatId, text, extra = {}) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', ...extra };
  const res = await fetch(`${API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('[bot] Telegram rechazó sendMessage:', res.status);
  }
}

async function sendLongMessage(chatId, text) {
  const MAX = 4000;
  if (text.length <= MAX) return sendMessage(chatId, text);

  const paragraphs = text.split('\n');
  let chunk = '';

  for (const paragraph of paragraphs) {
    const addition = (chunk ? '\n' : '') + paragraph;
    if ((chunk + addition).length > MAX) {
      if (chunk) await sendMessage(chatId, chunk);
      chunk = paragraph;
    } else {
      chunk += addition;
    }
  }

  if (chunk) await sendMessage(chatId, chunk);
}

// ─── Dispatcher principal ─────────────────────────────────────────────────────

export async function handleUpdate(update) {
  const message = update.message || update.callback_query?.message;
  if (!message) return;

  const chatId       = message.chat.id;
  const text         = (update.message?.text || '').trim();
  const callbackData = update.callback_query?.data;

  if (update.callback_query) {
    await answerCallback(update.callback_query.id);
  }

  if (text.startsWith('/')) {
    const [cmd, ...args] = text.split(' ');
    switch (cmd.toLowerCase()) {
      case '/start':         return handleStart(chatId);
      case '/ayuda':         return handleAyuda(chatId);
      case '/nuevatarea':    return handleNuevaTarea(chatId);
      case '/recomendacion': return handleRecomendacion(chatId);
      case '/vincular':      return handleVincular(chatId, args.join(' '));
      case '/desvincular':   return handleDesvincular(chatId);
      default:
        return sendMessage(chatId, 'Comando no reconocido. Escribe /ayuda para ver los comandos disponibles.');
    }
  }

  const session = getSession(chatId);

  if (callbackData) {
    return handleCallback(chatId, callbackData, session);
  }

  if (session.step) {
    if (session.step.startsWith('task_')) return handleTaskStep(chatId, text, session);
    if (session.step.startsWith('rec_'))  return handleRecStep(chatId, text, session);
  }

  await sendMessage(chatId, 'No entendí ese mensaje. Escribe /ayuda para ver los comandos disponibles.');
}

async function answerCallback(callbackId) {
  await fetch(`${API_BASE}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId }),
  });
}

// ─── Comandos ─────────────────────────────────────────────────────────────────

async function handleStart(chatId) {
  clearSession(chatId);
  const user = getUserByTelegramChatId(chatId);
  if (user) {
    await sendMessage(chatId,
      `👋 ¡Hola de nuevo, <b>${escapeTelegramHtml(displayName(user))}</b>!\n\n` +
      `Escribe /ayuda para ver todo lo que puedo hacer por ti.`
    );
  } else {
    await sendMessage(chatId,
      `👋 ¡Bienvenido a <b>NovaTareas Bot</b>!\n\n` +
      `Para comenzar, vincula tu cuenta con:\n` +
      `<code>/vincular CODIGO</code>\n\n` +
      `Genera el código temporal desde tu perfil web.\n\n` +
      `Escribe /ayuda para más información.`
    );
  }
}

async function handleAyuda(chatId) {
  clearSession(chatId);
  await sendMessage(chatId,
    `📋 <b>Comandos disponibles</b>\n\n` +
    `/start — Bienvenida\n` +
    `/ayuda — Muestra esta ayuda\n` +
    `/vincular &lt;código temporal&gt; — Conecta tu cuenta\n` +
    `/desvincular — Desconecta tu cuenta\n` +
    `/nuevatarea — Crea una tarea paso a paso\n` +
    `/recomendacion — Sugerencias de IA para una tarea`
  );
}

// ─── Vinculación ──────────────────────────────────────────────────────────────

async function handleVincular(chatId, args) {
  const code = (args || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{8}$/.test(code)) {
    return sendMessage(
      chatId,
      '⚠️ Uso correcto: <code>/vincular CODIGO</code>\nGenera el código desde tu perfil web.'
    );
  }

  const limit = consumeRateLimit(
    'telegram-link-attempt',
    String(chatId),
    8,
    15 * 60 * 1000
  );
  if (!limit.allowed) {
    return sendMessage(chatId, '⏳ Demasiados intentos. Intenta nuevamente más tarde.');
  }

  const user = consumeTelegramLinkCode(code, chatId);
  if (!user) {
    return sendMessage(
      chatId,
      '❌ Código inválido o vencido. Genera uno nuevo desde tu perfil.'
    );
  }
  resetRateLimit('telegram-link-attempt', String(chatId));
  await sendMessage(chatId,
    `✅ ¡Cuenta vinculada!\n` +
    `Bienvenido, <b>${escapeTelegramHtml(displayName(user))}</b>. Recibirás recordatorios aquí.\n\n` +
    `Escribe /ayuda para ver los comandos.`
  );
}

async function handleDesvincular(chatId) {
  const user = getUserByTelegramChatId(chatId);
  if (!user) return sendMessage(chatId, 'No hay ninguna cuenta vinculada a este chat.');
  linkTelegram(user.id, null);
  await sendMessage(chatId, '✅ Tu cuenta ha sido desvinculada de Telegram.');
}

// ─── Creación de tareas ───────────────────────────────────────────────────────

async function handleNuevaTarea(chatId) {
  const user = getUserByTelegramChatId(chatId);
  if (!user) {
    return sendMessage(chatId,
      '⚠️ Primero vincula tu cuenta.\nGenera un código en tu perfil web y envía <code>/vincular CODIGO</code>'
    );
  }

  clearSession(chatId);
  const session = getSession(chatId);
  session.step  = 'task_title';
  session.data  = { userId: user.id };

  await sendMessage(chatId, '📝 <b>Nueva tarea</b>\n\n¿Cuál es el <b>título</b> de la tarea?');
}

async function handleTaskStep(chatId, text, session) {
  const { step, data } = session;

  switch (step) {
    case 'task_title': {
      const normalizedTitle = String(text || '').trim();
      if (normalizedTitle.length < 2 || normalizedTitle.length > 200) {
        return sendMessage(chatId, '⚠️ El título debe tener entre 2 y 200 caracteres.');
      }
      data.title   = normalizedTitle;
      session.step = 'task_description';
      return sendMessage(chatId, '📄 ¿Cuál es la <b>descripción</b>?\n<i>(Escribe "no" para omitir)</i>');
    }

    case 'task_description': {
      const normalizedDescription = String(text || '').trim();
      if (normalizedDescription.length > 2000) {
        return sendMessage(chatId, '⚠️ La descripción no puede superar 2000 caracteres.');
      }
      data.description = normalizedDescription.toLowerCase() === 'no' ? '' : normalizedDescription;
      session.step     = 'task_due_date';
      return sendMessage(chatId,
        '📅 ¿Cuál es la <b>fecha límite</b>?\n' +
        'Formato: <code>YYYY-MM-DD</code> o <code>YYYY-MM-DD HH:MM</code>\n' +
        '<i>(Escribe "no" para omitir)</i>'
      );
    }

    case 'task_due_date': {
      if (text.toLowerCase() === 'no') {
        data.due_date = null;
      } else {
        const candidate = text.trim();
        const validation = validateTaskInput({
          title: data.title,
          due_date: candidate,
        });
        if (validation.error) {
          return sendMessage(chatId,
            '⚠️ Fecha inválida. Usa el formato <code>2025-12-31</code>.'
          );
        }
        data.due_date = candidate;
      }
      session.step = 'task_priority';
      return sendMessage(chatId, '🔢 ¿Cuál es la <b>prioridad</b>?', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔴 Urgente', callback_data: 'priority_urgente' },
            { text: '🟠 Alta',    callback_data: 'priority_alta'    },
            { text: '🟡 Media',   callback_data: 'priority_media'   },
            { text: '🟢 Baja',    callback_data: 'priority_baja'    },
          ]],
        },
      });
    }

    case 'task_priority': {
      const valid = ['urgente', 'alta', 'media', 'baja'];
      const p = text.toLowerCase();
      data.priority = valid.includes(p) ? p : 'media';
      return askCategory(chatId, session);
    }

    case 'task_category': {
      if (text.toLowerCase() === 'no') {
        data.category_id = null;
      } else {
        const catId = parseInt(text, 10);
        if (!Number.isInteger(catId) || catId <= 0) {
          return sendMessage(chatId, '⚠️ Escribe el número de la categoría o "no".');
        }
        data.category_id = catId;
      }
      return saveTask(chatId, session);
    }

    default:
      clearSession(chatId);
      return sendMessage(chatId, '❌ Sesión expirada. Usa /nuevatarea para comenzar de nuevo.');
  }
}

async function askCategory(chatId, session) {
  const categories = getCategoriesByUser(session.data.userId);

  if (categories.length === 0) {
    session.data.category_id = null;
    return saveTask(chatId, session);
  }

  session.step  = 'task_category';
  const buttons = categories.map(c => [{ text: c.name, callback_data: `cat_${c.id}` }]);
  buttons.push([{ text: 'Sin categoría', callback_data: 'cat_none' }]);

  await sendMessage(chatId, '🏷️ ¿A qué <b>categoría</b> pertenece?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function saveTask(chatId, session) {
  const { userId, title, description, due_date, priority, category_id } = session.data;

  try {
    const validation = validateTaskInput({
      title,
      description: description || '',
      due_date: due_date || null,
      priority: priority || 'media',
    });
    if (validation.error) {
      clearSession(chatId);
      return sendMessage(chatId, `⚠️ ${escapeTelegramHtml(validation.error)}`);
    }

    if (category_id) {
      const ownedCategory = db.prepare(
        'SELECT id FROM categories WHERE id = ? AND user_id = ?'
      ).get(category_id, userId);
      if (!ownedCategory) {
        return sendMessage(chatId, '⚠️ La categoría seleccionada no pertenece a tu cuenta.');
      }
    }

    const task = validation.values;
    db.prepare(
      `INSERT INTO tasks (user_id, title, description, due_date, priority, category_id, completed, reminder_sent)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(
      userId,
      task.title,
      task.description || '',
      task.due_date || null,
      task.priority || 'media',
      category_id || null
    );

    clearSession(chatId);
    await sendMessage(chatId,
      `✅ <b>Tarea creada</b>\n\n` +
      `📌 <b>${escapeTelegramHtml(task.title)}</b>\n` +
      (task.description ? `📄 ${escapeTelegramHtml(task.description)}\n` : '') +
      (task.due_date ? `📅 Vence: ${task.due_date}\n` : '') +
      `🔢 Prioridad: ${escapeTelegramHtml(task.priority || 'media')}`
    );
  } catch (err) {
    console.error('[bot] Error al guardar tarea:', err?.code || err?.name || 'error');
    clearSession(chatId);
    await sendMessage(chatId, '❌ Error al guardar la tarea. Inténtalo de nuevo.');
  }
}

// ─── Recomendaciones con IA ───────────────────────────────────────────────────

async function handleRecomendacion(chatId) {
  const user = getUserByTelegramChatId(chatId);
  if (!user) {
    return sendMessage(chatId,
      '⚠️ Primero vincula tu cuenta.\nGenera un código en tu perfil web y envía <code>/vincular CODIGO</code>'
    );
  }

  const tasks = getTasksByUser(user.id).filter(t => !t.completed && !t.archived);

  if (tasks.length === 0) {
    return sendMessage(chatId, 'No tienes tareas pendientes en este momento.');
  }

  clearSession(chatId);
  const session = getSession(chatId);
  session.step  = 'rec_select';
  session.data  = { userId: user.id, tasks, userType: user.user_type || 'comun' };

  const buttons = tasks.slice(0, 10).map(t => [
    { text: t.title.substring(0, 40), callback_data: `rec_task_${t.id}` },
  ]);
  buttons.push([{ text: '✏️ Describir manualmente', callback_data: 'rec_manual' }]);

  await sendMessage(chatId,
    '🤖 <b>Recomendaciones con IA</b>\n\nSelecciona una tarea:',
    { reply_markup: { inline_keyboard: buttons } }
  );
}

async function handleRecStep(chatId, text, session) {
  if (session.step === 'rec_manual') {
    await sendMessage(chatId, '⏳ Analizando...');
    const rec = await getAiRecommendation(text, session.data?.userType, session.data?.userId);
    clearSession(chatId);
    return sendLongMessage(chatId, `💡 <b>Recomendaciones</b>\n\n${mdToHtml(rec)}`);
  }
  clearSession(chatId);
}

// ─── Motor de IA ──────────────────────────────────────────────────────────────

async function getAiRecommendation(taskDescription, userType = 'comun', userId = null) {
  const typeContext = {
    estudiante: 'El usuario es estudiante universitario. Enfoca las recomendaciones en técnicas de estudio, organización académica y gestión del tiempo para tareas escolares.',
    empleado:   'El usuario es empleado. Enfoca las recomendaciones en productividad laboral, priorización profesional y eficiencia en el trabajo.',
    comun:      'El usuario es una persona con tareas cotidianas. Enfoca las recomendaciones en organización personal y productividad diaria.',
  };
  const contextLine = typeContext[userType] || typeContext.comun;
  const prompt =
    `Eres un asistente de productividad experto. ${contextLine}\n\n` +
    `Tarea: "${taskDescription}"\n\n` +
    `Genera exactamente 3 recomendaciones numeradas (1. 2. 3.) para completar esta tarea. ` +
    `Cada una debe tener máximo 3 oraciones. Sin introducciones ni conclusiones. ` +
    `Responde solo con las 3 recomendaciones en español.`;

  // 1. z.ai
  if (ZAI_API_KEY) {
    const zaiText = await tryZai(prompt);
    if (zaiText) return zaiText;
  }

  // 2. Ollama
  const ollamaText = await tryOllama(prompt);
  if (ollamaText) return ollamaText;

  // 3. Historial de tareas archivadas
  if (userId) {
    const archivedRec = getRecommendationFromArchived(userId, taskDescription);
    if (archivedRec) return archivedRec;
  }

  // 4. Reglas locales
  return getRulesRecommendation(taskDescription, userType);
}

async function tryZai(prompt) {
  try {
    const res = await fetch(ZAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZAI_API_KEY}`
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.75
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      console.error('[tryZai] Respuesta no exitosa:', res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[tryZai] Fallo de red o proveedor');
    return null;
  }
}

async function tryOllama(prompt) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:  OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.75, num_predict: 400 }
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.response?.trim() || null;
  } catch {
    return null;
  }
}

function getRecommendationFromArchived(userId, taskDescription) {
  try {
    const archived = db.prepare(`
      SELECT title, what_worked, what_failed, observations
      FROM tasks
      WHERE user_id = ? AND archived = 1
        AND (what_worked IS NOT NULL OR what_failed IS NOT NULL OR observations IS NOT NULL)
      ORDER BY archived_at DESC
      LIMIT 20
    `).all(userId);

    if (!archived.length) return null;

    const descWords = taskDescription.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let bestMatch = null;
    let bestScore = 0;

    for (const task of archived) {
      const titleWords = (task.title || '').toLowerCase().split(/\s+/);
      const score = descWords.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw))).length;
      if (score > bestScore) { bestScore = score; bestMatch = task; }
    }

    const source = (bestScore > 0 ? bestMatch : archived[0]);
    if (!source) return null;

    const parts = [];
    parts.push(`📂 <b>Basado en tu historial de tareas similares:</b>`);
    if (source.what_worked) {
      parts.push(`\n✅ <b>Lo que funcionó antes:</b> ${source.what_worked}`);
      parts.push(`\n💡 Aplica ese mismo enfoque: empieza por lo que ya sabes que te funciona.`);
    }
    if (source.what_failed) {
      parts.push(`\n⚠️ <b>Lo que no funcionó:</b> ${source.what_failed}`);
      parts.push(`\n🎯 Evita repetir ese error: planifica antes de empezar.`);
    }
    if (source.observations) {
      parts.push(`\n📝 <b>Observación anterior:</b> ${source.observations}`);
    }
    parts.push(`\n\n<i>(Recomendación desde tu historial — IA no disponible)</i>`);

    return parts.join('');
  } catch {
    return null;
  }
}

function getRulesRecommendation(description, userType) {
  const lower = description.toLowerCase();

  if (lower.includes('examen') || lower.includes('exam') || lower.includes('prueba')) {
    return (
      '1. 📚 Divide el temario en bloques de 25 minutos (Pomodoro) y empieza por los temas que menos dominas.\n\n' +
      '2. ✍️ Crea un resumen con tus propias palabras de cada bloque: explicar en voz alta fija el conocimiento.\n\n' +
      '3. 😴 Descansa bien la noche anterior: el sueño es esencial para consolidar lo que estudiaste.'
    );
  }
  if (lower.includes('reunión') || lower.includes('reunion') || lower.includes('junta')) {
    return (
      '1. 📋 Prepara una agenda con los 3 puntos más importantes y el tiempo estimado para cada uno.\n\n' +
      '2. 🔍 Revisa la información clave 30 minutos antes para llegar con contexto fresco.\n\n' +
      '3. ✅ Define de antemano cuál es el resultado concreto que quieres lograr en la reunión.'
    );
  }
  if (lower.includes('informe') || lower.includes('reporte') || lower.includes('entrega')) {
    return (
      '1. 🗂️ Estructura primero: escribe los títulos de cada sección antes de redactar.\n\n' +
      '2. ✍️ Redacta un borrador rápido sin editar — la perfección viene en la revisión final.\n\n' +
      '3. ⏰ Bloquea al menos 1 hora hoy para avanzar el 50%; dejar para el final genera errores.'
    );
  }
  if (lower.includes('ejercicio') || lower.includes('gym') || lower.includes('entren')) {
    return (
      '1. 👟 Prepara tu ropa y equipo la noche anterior para reducir la fricción al levantarte.\n\n' +
      '2. 📅 Agéndalo como una cita inamovible: el horario fijo convierte el ejercicio en hábito.\n\n' +
      '3. 🎯 Define una meta concreta para la sesión (ej: 30 min de cardio o 3 series) antes de empezar.'
    );
  }

  const tips = {
    estudiante: (
      '1. 📚 Divide la tarea en partes pequeñas y asigna tiempo fijo a cada una en tu agenda.\n\n' +
      '2. 🎯 Empieza por la parte más difícil cuando tu energía está alta (generalmente por la mañana).\n\n' +
      '3. 📵 Silencia el teléfono y trabaja en un lugar sin distracciones durante al menos 25 minutos seguidos.'
    ),
    empleado: (
      '1. 💼 Define el resultado concreto esperado y escríbelo antes de empezar a trabajar.\n\n' +
      '2. 📅 Bloquea tiempo en tu calendario (mínimo 45 min) para trabajar sin interrupciones.\n\n' +
      '3. 📣 Si involucra a otros, comunica tu avance para alinear expectativas y evitar retrabajos.'
    ),
    comun: (
      '1. 🗂️ Divide la tarea en 3 pasos concretos y empieza por el más sencillo para ganar impulso.\n\n' +
      '2. ⏰ Asigna un tiempo fijo hoy, aunque sean 20 minutos — comenzar es lo más difícil.\n\n' +
      '3. 📌 Prepara todo lo que necesitas antes de empezar para no interrumpir el flujo.'
    ),
  };

  return tips[userType] || tips.comun;
}

// ─── Handler de callbacks ─────────────────────────────────────────────────────

async function handleCallback(chatId, data, session) {
  if (data.startsWith('priority_')) {
    const priority        = data.replace('priority_', '');
    session.data.priority = priority;
    session.step          = 'task_priority';
    return askCategory(chatId, session);
  }

  if (data.startsWith('cat_')) {
    const catId = data === 'cat_none' ? null : parseInt(data.replace('cat_', ''), 10);
    session.data.category_id = catId;
    return saveTask(chatId, session);
  }

  if (data.startsWith('rec_task_')) {
    const taskId = parseInt(data.replace('rec_task_', ''), 10);
    let task = session.data?.tasks?.find(t => t.id === taskId);
    if (!task) {
      const user = getUserByTelegramChatId(chatId);
      if (!user) return sendMessage(chatId, '⚠️ Sesión expirada. Usa /recomendacion de nuevo.');
      task = getTasksByUser(user.id).find(t => t.id === taskId);
    }
    if (!task) return sendMessage(chatId, '❌ Tarea no encontrada.');

    await sendMessage(chatId, '⏳ Analizando la tarea...');
    const user = getUserByTelegramChatId(chatId);
    const desc = `${task.title}${task.description ? ': ' + task.description : ''}`;
    const rec  = await getAiRecommendation(desc, user?.user_type || session.data?.userType || 'comun', user?.id);
    clearSession(chatId);
    return sendLongMessage(chatId, `💡 <b>Recomendaciones para "${escapeTelegramHtml(task.title)}"</b>\n\n${mdToHtml(rec)}`);
  }

  if (data === 'rec_manual') {
    session.step = 'rec_manual';
    return sendMessage(chatId, '✏️ Describe la tarea sobre la que necesitas recomendaciones:');
  }
}

// ─── Recordatorios automáticos ────────────────────────────────────────────────

export async function sendReminders(windowMinutes = 30) {
  const dueTasks = getUsersWithDueTasks(windowMinutes);

  for (const row of dueTasks) {
    const dueDate   = new Date(Number(row.due_date));
    const formatted = dueDate.toLocaleString('es-SV', { dateStyle: 'full', timeStyle: 'short' });

    try {
      await sendMessage(
        row.telegram_chat_id,
        `⏰ <b>Recordatorio de tarea</b>\n\n` +
        `📌 <b>${escapeTelegramHtml(row.title)}</b>\n` +
        `🗓️ Vence: ${formatted}\n\n` +
        `¡No olvides completarla a tiempo!`
      );
      markReminderSent(row.task_id);
    } catch (err) {
      console.error('[bot] Error enviando recordatorio:', safeErrorSummary(err));
    }
  }
}
