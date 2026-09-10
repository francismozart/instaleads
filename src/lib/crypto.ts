import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Authenticated symmetric encryption (AES-256-GCM) for state at rest — used to
 * encrypt any exported browser session state before it touches disk. The key is
 * derived from STATE_ENCRYPTION_KEY via scrypt with a per-payload salt.
 */
const ALGO = "aes-256-gcm";

export function encryptString(plaintext: string, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptString(payload: string, secret: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4) throw new Error("Payload criptografado malformado");
  const [salt, iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64"));
  const key = scryptSync(secret, salt!, 32);
  const decipher = createDecipheriv(ALGO, key, iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(enc!), decipher.final()]).toString("utf8");
}
