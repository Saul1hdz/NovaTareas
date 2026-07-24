import { timingSafeEqual } from 'node:crypto';

const rateLimitBuckets = new Map();

export function safeEqualStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'local';
}

export function consumeRateLimit(namespace, key, maxAttempts, windowMs) {
  const bucketKey = `${namespace}:${key}`;
  const now = Date.now();
  const recent = (rateLimitBuckets.get(bucketKey) || [])
    .filter(timestamp => now - timestamp < windowMs);

  if (recent.length >= maxAttempts) {
    const retryAfterMs = Math.max(1, windowMs - (now - recent[0]));
    rateLimitBuckets.set(bucketKey, recent);
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  recent.push(now);
  rateLimitBuckets.set(bucketKey, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimit(namespace, key) {
  rateLimitBuckets.delete(`${namespace}:${key}`);
}

export function safeErrorSummary(error) {
  const status = Number(error?.response?.status ?? error?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return `HTTP ${status}`;
  }

  const code = String(error?.code || '').trim();
  if (/^[A-Z0-9_-]{1,40}$/i.test(code)) return `código ${code}`;

  const name = String(error?.name || '').trim();
  if (/^[A-Z][A-Za-z0-9]{0,39}(Error)?$/.test(name)) return name;

  return 'error externo';
}
