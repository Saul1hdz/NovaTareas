import { describe, expect, it } from 'vitest';
import {
  decryptToken,
  encryptToken,
  isEncryptedToken,
  isTokenEncryptionConfigured,
} from '../src/lib/tokenEncryption.js';

describe('cifrado de tokens persistidos', () => {
  it('cifra con AES-GCM y recupera el valor original', () => {
    const encrypted = encryptToken('token-google-ficticio');

    expect(isTokenEncryptionConfigured()).toBe(true);
    expect(isEncryptedToken(encrypted)).toBe(true);
    expect(encrypted).not.toContain('token-google-ficticio');
    expect(decryptToken(encrypted)).toBe('token-google-ficticio');
  });

  it('rechaza tokens en texto plano', () => {
    expect(() => decryptToken('token-sin-cifrar')).toThrow(/no está cifrado/i);
  });

  it('detecta alteraciones del ciphertext', () => {
    const encrypted = encryptToken('token-ficticio');
    const tampered = `${encrypted.slice(0, -1)}A`;

    expect(() => decryptToken(tampered)).toThrow(/descifrar/i);
  });
});
