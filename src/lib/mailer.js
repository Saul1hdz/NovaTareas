import nodemailer from 'nodemailer';

/**
 * Envío de correo transaccional por SMTP (Mailcow de la familia en producción).
 *
 * Si SMTP no está configurado, las funciones de envío devuelven
 * `{ sent: false, skipped: 'smtp_no_config' }` en lugar de lanzar: así el
 * registro no se rompe en entornos locales sin buzón. La decisión de exigir
 * verificación o no la toma cada flujo con `emailVerificationRequired()`.
 */

let transport = null;

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim());
}

export function emailVerificationRequired() {
  return process.env.EMAIL_VERIFICATION_REQUIRED === 'true';
}

export function appBaseUrl() {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  // Fallback para desarrollo local; en producción se define PUBLIC_APP_URL.
  return 'http://127.0.0.1:4321';
}

function getTransport() {
  if (transport) return transport;
  if (!smtpConfigured()) return null;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST.trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS || '',
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
  return transport;
}

function fromAddress() {
  return process.env.SMTP_FROM?.trim()
    || `"NovaTareas" <${process.env.SMTP_USER.trim()}>`;
}

/**
 * Envía un correo. Nunca imprime credenciales ni tokens en logs; el error se
 * resume con safeErrorSummary en el llamador.
 */
export async function sendMail({ to, subject, text, html }) {
  const transporter = getTransport();
  if (!transporter) return { sent: false, skipped: 'smtp_no_config' };
  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject,
      text,
      html: html || text,
    });
    return { sent: true };
  } catch {
    return { sent: false, skipped: 'smtp_error' };
  }
}

/** Enlace de verificación de correo que consume `verify-email`. */
export function verificationLink(token) {
  return `${appBaseUrl()}/api/verify-email?token=${encodeURIComponent(token)}`;
}

/** Enlace de recuperación que abre la página de login en el paso de contraseña. */
export function recoveryLink(token) {
  return `${appBaseUrl()}/?recovery_token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail({ to, token, name }) {
  const link = verificationLink(token);
  const displayName = (name || '').trim() || to;
  return sendMail({
    to,
    subject: 'Confirma tu correo · NovaTareas',
    text:
      `Hola ${displayName},\n\n` +
      `Confirma tu correo para activar tu cuenta de NovaTareas:\n${link}\n\n` +
      `El enlace es de un solo uso y expira en 24 horas.\n` +
      `Si no creaste una cuenta, ignora este mensaje.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">` +
      `<h2 style="color:#6c5ce7">NovaTareas</h2>` +
      `<p>Hola <b>${escapeHtml(displayName)}</b>,</p>` +
      `<p>Confirma tu correo para activar tu cuenta:</p>` +
      `<p><a href="${escapeHtmlAttr(link)}" style="display:inline-block;padding:10px 18px;background:#6c5ce7;color:#fff;border-radius:6px;text-decoration:none">Confirmar correo</a></p>` +
      `<p style="color:#666;font-size:13px">El enlace es de un solo uso y expira en 24 horas. Si no creaste una cuenta, ignora este mensaje.</p>` +
      `</div>`,
  });
}

export async function sendPasswordResetEmail({ to, token, name }) {
  const link = recoveryLink(token);
  const displayName = (name || '').trim() || to;
  return sendMail({
    to,
    subject: 'Recupera tu contraseña · NovaTareas',
    text:
      `Hola ${displayName},\n\n` +
      `Para restablecer tu contraseña de NovaTareas abre este enlace:\n${link}\n\n` +
      `El enlace es de un solo uso y expira en 15 minutos.\n` +
      `Si no lo solicitaste, ignora este mensaje.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">` +
      `<h2 style="color:#6c5ce7">NovaTareas</h2>` +
      `<p>Hola <b>${escapeHtml(displayName)}</b>,</p>` +
      `<p>Para restablecer tu contraseña abre este enlace:</p>` +
      `<p><a href="${escapeHtmlAttr(link)}" style="display:inline-block;padding:10px 18px;background:#6c5ce7;color:#fff;border-radius:6px;text-decoration:none">Restablecer contraseña</a></p>` +
      `<p style="color:#666;font-size:13px">El enlace es de un solo uso y expira en 15 minutos. Si no lo solicitaste, ignora este mensaje.</p>` +
      `</div>`,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll('&quot;', '&quot;');
}
