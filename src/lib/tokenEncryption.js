import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const PREFIX = 'enc:v1';

function getKey() {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error('TOKEN_ENCRYPTION_KEY no está configurada.');
  }

  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== encoded) {
    throw new Error('TOKEN_ENCRYPTION_KEY debe contener exactamente 32 bytes en base64url.');
  }
  return key;
}

export function isTokenEncryptionConfigured() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

export function isEncryptedToken(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

export function encryptToken(value) {
  if (value == null || value === '') return null;
  if (isEncryptedToken(value)) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptToken(value) {
  if (value == null || value === '') return null;
  if (!isEncryptedToken(value)) {
    throw new Error('El token persistido no está cifrado.');
  }

  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Formato de token cifrado inválido.');
  }

  try {
    const iv = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const encrypted = Buffer.from(parts[4], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('No se pudo descifrar el token persistido.');
  }
}
