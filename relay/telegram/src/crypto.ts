const CREDENTIAL_HASH_VERSION = "v1";
const CREDENTIAL_HASH_ALGORITHM = "sha256";

export interface CredentialHashOptions {
  namespace: "device-secret" | "pairing-token";
  salt?: string;
}

export async function hashCredential(value: string, options: CredentialHashOptions): Promise<string> {
  const salt = options.salt ?? randomBase64Url(16);
  const digest = await sha256Base64Url(`${options.namespace}\0${salt}\0${value}`);
  return [CREDENTIAL_HASH_VERSION, options.namespace, CREDENTIAL_HASH_ALGORITHM, salt, digest].join(":");
}

export async function verifyCredential(value: string, storedHash: string, namespace: CredentialHashOptions["namespace"]): Promise<boolean> {
  const parts = storedHash.split(":");

  if (parts.length !== 5) {
    return false;
  }

  const [version, storedNamespace, algorithm, salt, digest] = parts;

  if (version !== CREDENTIAL_HASH_VERSION || storedNamespace !== namespace || algorithm !== CREDENTIAL_HASH_ALGORITHM) {
    return false;
  }

  const candidate = await hashCredential(value, { namespace, salt });
  const candidateDigest = candidate.split(":")[4] ?? "";
  return constantTimeEqual(candidateDigest, digest);
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  cryptoProvider().getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await cryptoProvider().subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function cryptoProvider(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Web Crypto is required for the Telegram relay.");
  }

  return globalThis.crypto;
}
