import { describe, expect, it } from "vitest";
import { base64Decode } from "../src/crypto.js";
import { canonicalizeIp, networkKeys } from "../src/network.js";
import { testSecret } from "./helpers.js";

const KEY = base64Decode(testSecret())!;
const DAY = "2026-09-25";

async function keysFor(ip: string, day = DAY) {
  const network = canonicalizeIp(ip);
  if (!network) throw new Error(`unparsable ${ip}`);
  return networkKeys(network, day, KEY);
}

describe("network keys", () => {
  it("rejects missing and garbage CF-Connecting-IP values", () => {
    for (const bad of [null, "", "unknown", "1.2.3", "256.1.1.1", "1.2.3.4.5", "::g", "1::2::3", "fe80::1%en0", "1.2.3.4, 5.6.7.8", "1:2:3:4:5:6:7:8:9", " "]) {
      expect(canonicalizeIp(bad)).toBeNull();
    }
  });

  it("canonicalizes IPv4 with leading zeros to the same key", async () => {
    expect(canonicalizeIp("010.001.002.003")).toEqual({ family: 4, prefix: "4|10.1.2.3" });
    expect(await keysFor("010.001.002.003")).toEqual(await keysFor("10.1.2.3"));
  });

  it("maps IPv4-mapped IPv6 to the IPv4 address", async () => {
    expect(await keysFor("::ffff:10.1.2.3")).toEqual(await keysFor("10.1.2.3"));
    expect(await keysFor("::FFFF:0a01:0203")).toEqual(await keysFor("10.1.2.3"));
    expect((await keysFor("10.1.2.3")).net48).toBeNull();
  });

  it("treats compressed and expanded IPv6 alike and masks to /64", async () => {
    expect(await keysFor("2001:db8::1")).toEqual(await keysFor("2001:0DB8:0000:0000:0000:0000:0000:0001"));
    expect((await keysFor("2001:db8:0:0:aaaa::1")).net).toBe((await keysFor("2001:db8::ffff:ffff:1")).net);
    expect((await keysFor("2001:db8:0:1::1")).net).not.toBe((await keysFor("2001:db8:0:2::1")).net);
  });

  it("shares a /48 key across /64s inside it", async () => {
    const a = await keysFor("2001:db8:5:1::1");
    const b = await keysFor("2001:db8:5:ffff::1");
    const c = await keysFor("2001:db8:6:1::1");
    expect(a.net).not.toBe(b.net);
    expect(a.net48).toBe(b.net48);
    expect(a.net48).not.toBe(c.net48);
  });

  it("stores keyed hashes, not IPs, and they change every day", async () => {
    const today = await keysFor("198.51.100.23");
    const tomorrow = await keysFor("198.51.100.23", "2026-09-26");
    expect(today.net).not.toContain("198");
    expect(today.net).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(today.net).not.toBe(tomorrow.net);
  });
});
