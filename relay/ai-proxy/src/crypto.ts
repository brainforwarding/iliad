// Web Crypto helpers (HMAC-SHA256, base64url, constant-time compare), adapted
// from the removed relay/telegram crypto.ts.

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Decodes base64url or standard base64 (padding optional); null if malformed. */
export function base64Decode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/u.test(text)) return null;
  const normalized = text.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/u, "");
  if (normalized.length % 4 === 1) return null;
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
  const cacheKey = base64UrlEncode(secret);
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function hmacSha256(secret: Uint8Array, data: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(data) as BufferSource);
  return new Uint8Array(signature);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}
