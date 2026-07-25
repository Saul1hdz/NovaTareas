/**
 * Criterio único de "hoy" para toda la aplicación.
 *
 * Vivía dentro de telegramNotify.js, así que el dashboard calculaba el día en
 * UTC por su cuenta y discrepaba con las notificaciones varias horas al día:
 * una tarea podía aparecer vencida en la web y no en Telegram, o al revés.
 */
export const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'America/El_Salvador';

/** Minutos de desfase de APP_TIME_ZONE respecto a UTC en un instante dado. */
function zoneOffsetMinutes(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );

  const asUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour % 24, parts.minute, parts.second,
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Convierte un día ('YYYY-MM-DD') y una hora local de APP_TIME_ZONE en el
 * instante absoluto correspondiente. Sirve para programar recordatorios a una
 * hora que tenga sentido para la persona, no para el reloj del servidor.
 */
export function instantInAppTimeZone(day, hour = 9, minute = 0) {
  const naive = new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
  );
  if (Number.isNaN(naive.getTime())) return null;
  return new Date(naive.getTime() - zoneOffsetMinutes(naive) * 60_000);
}

/**
 * Recordatorio por defecto de una tarea: la mañana de su fecha límite. Devuelve
 * null si ese instante ya pasó, para no programar un aviso que nunca se enviará.
 */
export function defaultReminderFor(dueDate, now = new Date()) {
  if (!dueDate) return null;
  const instant = instantInAppTimeZone(String(dueDate).slice(0, 10));
  if (!instant || instant.getTime() <= now.getTime()) return null;
  return instant;
}

export function dateInAppTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}
