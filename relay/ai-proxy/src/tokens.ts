// Anonymous install tokens (spec §3): stateless, HMAC-signed.
//
//   v1.<kid>.<base64url(JSON{sub,iat,exp,kind})>.<base64url(HMAC-SHA256)>
//
// The HMAC covers `v1.<kid>.<payload>`. `TOKEN_SIGNING_KEYS` (secret) is a JSON
// map `kid → { key, signs, verifiesUntil? }`: exactly one kid signs; the
// others only verify (until `verifiesUntil`, if set), so rotation never
// strands live installs. Nothing is stored per token.

import { base64Decode, base64UrlEncode, constantTimeEqual, hmacSha256, randomBytes, utf8 } from "./crypto.js";

export type TokenKind = "install";

export interface TokenClaims {
  sub: string;
  /** Seconds since the epoch. */
  iat: number;
  exp: number;
  kind: TokenKind;
}

export interface SigningKey {
  key: Uint8Array;
  signs: boolean;
  /** Epoch ms after which tokens with this kid are rejected; null = no end. */
  verifiesUntil: number | null;
}

export interface SigningKeys {
  signingKid: string;
  keys: ReadonlyMap<string, SigningKey>;
}

const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SUB_PATTERN = /^inst_[A-Za-z0-9_-]{22}$/;
const MAX_TOKEN_CHARS = 512;

export function parseSigningKeys(json: string | undefined): SigningKeys | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const keys = new Map<string, SigningKey>();
  let signingKid: string | null = null;
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KID_PATTERN.test(kid) || typeof value !== "object" || value === null) return null;
    const { key, signs, verifiesUntil } = value as Record<string, unknown>;
    const bytes = typeof key === "string" ? base64Decode(key) : null;
    if (!bytes || bytes.length < 32) return null;
    if (typeof signs !== "boolean") return null;
    let until: number | null = null;
    if (verifiesUntil !== undefined && verifiesUntil !== null) {
      if (typeof verifiesUntil !== "string") return null;
      until = Date.parse(verifiesUntil);
      if (!Number.isFinite(until)) return null;
    }
    if (signs) {
      if (signingKid !== null || until !== null) return null;
      signingKid = kid;
    }
    keys.set(kid, { key: bytes, signs, verifiesUntil: until });
  }
  return signingKid ? { signingKid, keys } : null;
}

export function newSubject(): string {
  return `inst_${base64UrlEncode(randomBytes(16))}`;
}

export async function signToken(keys: SigningKeys, claims: TokenClaims): Promise<string> {
  const signing = keys.keys.get(keys.signingKid);
  if (!signing) throw new Error("no signing key");
  const payload = base64UrlEncode(utf8(JSON.stringify({ sub: claims.sub, iat: claims.iat, exp: claims.exp, kind: claims.kind })));
  const signed = `v1.${keys.signingKid}.${payload}`;
  return `${signed}.${base64UrlEncode(await hmacSha256(signing.key, signed))}`;
}

export async function issueToken(keys: SigningKeys, options: { sub: string; nowMs: number; ttlDays: number }): Promise<string> {
  const iat = Math.floor(options.nowMs / 1000);
  return signToken(keys, { sub: options.sub, iat, exp: iat + options.ttlDays * 86_400, kind: "install" });
}

export type TokenVerification =
  | { ok: true; claims: TokenClaims }
  /** Valid signature, past `exp`: the claims are trustworthy (refresh uses them). */
  | { ok: false; reason: "expired"; claims: TokenClaims }
  | { ok: false; reason: "invalid" };

export async function verifyToken(keys: SigningKeys, token: string, nowMs: number): Promise<TokenVerification> {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (token.length > MAX_TOKEN_CHARS) return invalid;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return invalid;
  const [, kid, payload, signature] = parts;
  const key = keys.keys.get(kid);
  if (!key) return invalid;
  if (key.verifiesUntil !== null && nowMs >= key.verifiesUntil) return invalid;

  const expected = base64UrlEncode(await hmacSha256(key.key, `v1.${kid}.${payload}`));
  if (!constantTimeEqual(expected, signature)) return invalid;

  const claims = parseClaims(payload);
  if (!claims) return invalid;
  if (nowMs >= claims.exp * 1000) return { ok: false, reason: "expired", claims };
  return { ok: true, claims };
}

function parseClaims(payload: string): TokenClaims | null {
  const bytes = base64Decode(payload);
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { sub, iat, exp, kind } = value as Record<string, unknown>;
  if (typeof sub !== "string" || !SUB_PATTERN.test(sub)) return null;
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || (exp as number) <= (iat as number)) return null;
  // Limits are looked up by kind; `account` joins with login (spec §3, §10).
  if (kind !== "install") return null;
  return { sub, iat: iat as number, exp: exp as number, kind };
}

/** `Authorization: Bearer <token>` → the token, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._-]{1,512})$/.exec(header.trim());
  return match ? match[1] : null;
}
