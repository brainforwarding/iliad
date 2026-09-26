import { describe, expect, it } from "vitest";
import { base64UrlEncode } from "../src/crypto.js";
import { issueToken, newSubject, parseSigningKeys, signToken, verifyToken } from "../src/tokens.js";
import { testSecret } from "./helpers.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const DAY = 86_400_000;

function keys(json: Record<string, unknown>) {
  const parsed = parseSigningKeys(JSON.stringify(json));
  if (!parsed) throw new Error("bad keys");
  return parsed;
}

describe("install tokens", () => {
  const k1 = testSecret();
  const k2 = testSecret();

  it("signs and verifies v1.<kid>.<payload>.<sig>", async () => {
    const signing = keys({ k1: { key: k1, signs: true } });
    const sub = newSubject();
    const token = await issueToken(signing, { sub, nowMs: NOW, ttlDays: 30 });
    expect(token.split(".")).toHaveLength(4);
    expect(token.startsWith("v1.k1.")).toBe(true);
    const verified = await verifyToken(signing, token, NOW + 1000);
    expect(verified).toEqual({ ok: true, claims: { sub, iat: NOW / 1000, exp: NOW / 1000 + 30 * 86_400, kind: "install" } });
    expect(sub).toMatch(/^inst_[A-Za-z0-9_-]{22}$/);
  });

  it("rejects tampered payloads, signatures, unknown kids and junk", async () => {
    const signing = keys({ k1: { key: k1, signs: true } });
    const token = await issueToken(signing, { sub: newSubject(), nowMs: NOW, ttlDays: 30 });
    const [v, kid, payload, sig] = token.split(".");
    const otherPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ sub: newSubject(), iat: 1, exp: 9e9, kind: "install" })));
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    for (const bad of [
      `${v}.${kid}.${otherPayload}.${sig}`,
      `${v}.${kid}.${payload}.${flipped}`,
      `${v}.k9.${payload}.${sig}`,
      `v2.${kid}.${payload}.${sig}`,
      "garbage",
      `${token}.extra`,
      "x".repeat(600)
    ]) {
      expect(await verifyToken(signing, bad, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("rejects unknown kinds even when signed", async () => {
    const signing = keys({ k1: { key: k1, signs: true } });
    const token = await signToken(signing, { sub: newSubject(), iat: NOW / 1000, exp: NOW / 1000 + 10, kind: "account" as "install" });
    expect(await verifyToken(signing, token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports expiry with trustworthy claims", async () => {
    const signing = keys({ k1: { key: k1, signs: true } });
    const token = await issueToken(signing, { sub: newSubject(), nowMs: NOW, ttlDays: 30 });
    expect((await verifyToken(signing, token, NOW + 30 * DAY - 1)).ok).toBe(true);
    const expired = await verifyToken(signing, token, NOW + 30 * DAY);
    expect(expired.ok).toBe(false);
    expect(expired.ok === false && expired.reason).toBe("expired");
  });

  it("rotates kids: old tokens verify during the grace period, then stop", async () => {
    const before = keys({ k1: { key: k1, signs: true } });
    const oldToken = await issueToken(before, { sub: newSubject(), nowMs: NOW, ttlDays: 30 });
    const after = keys({ k2: { key: k2, signs: true }, k1: { key: k1, signs: false, verifiesUntil: new Date(NOW + 10 * DAY).toISOString() } });
    expect((await verifyToken(after, oldToken, NOW + DAY)).ok).toBe(true);
    expect(await verifyToken(after, oldToken, NOW + 10 * DAY)).toEqual({ ok: false, reason: "invalid" });
    const newToken = await issueToken(after, { sub: newSubject(), nowMs: NOW, ttlDays: 30 });
    expect(newToken.startsWith("v1.k2.")).toBe(true);
    // Removing a kid invalidates every token signed with it.
    const removed = keys({ k2: { key: k2, signs: true } });
    expect(await verifyToken(removed, oldToken, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("validates TOKEN_SIGNING_KEYS", () => {
    expect(parseSigningKeys(undefined)).toBeNull();
    expect(parseSigningKeys("not json")).toBeNull();
    expect(parseSigningKeys(JSON.stringify({ k1: { key: k1, signs: false } }))).toBeNull();
    expect(parseSigningKeys(JSON.stringify({ k1: { key: k1, signs: true }, k2: { key: k2, signs: true } }))).toBeNull();
    expect(parseSigningKeys(JSON.stringify({ k1: { key: testSecret(16), signs: true } }))).toBeNull();
    expect(parseSigningKeys(JSON.stringify({ k1: { key: k1, signs: true, verifiesUntil: "2027-01-01" } }))).toBeNull();
    expect(parseSigningKeys(JSON.stringify({ "bad kid": { key: k1, signs: true } }))).toBeNull();
    expect(parseSigningKeys(JSON.stringify({ k1: { key: k1, signs: true }, k0: { key: k2, signs: false, verifiesUntil: "nope" } }))).toBeNull();
  });
});
