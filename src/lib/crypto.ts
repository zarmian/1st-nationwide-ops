/**
 * AES-256-GCM encryption for sensitive at-rest fields (alarm codes, padlock
 * codes). One key per environment, stored as base64 in process.env.ENCRYPTION_KEY.
 *
 * Format of stored ciphertext bytes:
 *   [12-byte IV][16-byte auth tag][ciphertext...]
 *
 * Generate a fresh key once with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Set ENCRYPTION_KEY in Vercel (Production scope) to that base64 string.
 * NEVER rotate it without re-encrypting existing rows — old ciphertext won't
 * decrypt under a new key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`,
      );
    }
    cachedKey = buf;
    return buf;
  } catch (e) {
    throw new Error(
      `ENCRYPTION_KEY is invalid base64 or wrong length: ${(e as Error).message}`,
    );
  }
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY);
}

/**
 * Encrypt a UTF-8 string. Returns the bytes ready to write to a Prisma
 * `Bytes` column. Returns null for null/empty input.
 */
export function encryptString(plaintext: string | null | undefined): Buffer | null {
  if (plaintext == null || plaintext === "") return null;
  const key = getKey();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not set — refusing to write sensitive data unencrypted.",
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/**
 * Decrypt bytes back to a UTF-8 string. Tolerates legacy plaintext rows
 * (when the bytes don't have the expected envelope shape) by returning
 * them as a UTF-8 string verbatim — useful during the migration window.
 */
export function decryptString(input: Buffer | Uint8Array | null | undefined): string | null {
  if (!input) return null;
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    // Too short to be a real envelope — treat as legacy plaintext.
    return buf.toString("utf8");
  }
  const key = getKey();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not set — cannot decrypt stored sensitive data.",
    );
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return out.toString("utf8");
  } catch {
    // GCM auth failure — almost certainly a key mismatch or corrupted row.
    // Don't leak the ciphertext bytes; return null so the caller can flag
    // the row for manual review.
    return null;
  }
}
