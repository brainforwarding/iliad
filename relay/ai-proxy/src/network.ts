// Network key for the per-IP quota (spec §4 "Network key"). Only
// `CF-Connecting-IP` is read (never X-Forwarded-For); a missing or unparsable
// value is a 400, never an "unknown" bucket. IPv4 → the full address; IPv6 →
// its /64 (and /48 for install issuance); IPv4-mapped IPv6 → the IPv4
// address. Stored keys are HMAC(IP_HASH_KEY, day + ":" + prefix) truncated to
// 16 bytes: not IPs, and not linkable across days.

import { base64UrlEncode, hmacSha256 } from "./crypto.js";

export type CanonicalNetwork =
  | { family: 4; prefix: string }
  | { family: 6; prefix: string; prefix48: string };

export function canonicalizeIp(raw: string | null): CanonicalNetwork | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > 64) return null;

  const v4 = parseIpv4(value);
  if (v4) return { family: 4, prefix: `4|${v4.join(".")}` };

  const v6 = parseIpv6(value);
  if (!v6) return null;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:XXXX:XXXX) → the IPv4 address.
  if (v6.slice(0, 5).every((part) => part === 0) && v6[5] === 0xffff) {
    const mapped = [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff];
    return { family: 4, prefix: `4|${mapped.join(".")}` };
  }
  const hex = v6.map((part) => part.toString(16).padStart(4, "0"));
  return { family: 6, prefix: `6/64|${hex.slice(0, 4).join(":")}`, prefix48: `6/48|${hex.slice(0, 3).join(":")}` };
}

function parseIpv4(value: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  // Decimal, leading zeros ignored (never octal).
  const octets = match.slice(1).map((part) => Number.parseInt(part, 10));
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function parseIpv6(input: string): number[] | null {
  const value = input.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(value) || !value.includes(":")) return null;

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (text: string, allowTrailingIpv4: boolean): number[] | null => {
    if (!text) return [];
    const groups = text.split(":");
    const out: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (allowTrailingIpv4 && index === groups.length - 1 && group.includes(".")) {
        const v4 = parseIpv4(group);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = parseGroups(halves[0], true);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseGroups(halves[0], false);
  const tail = parseGroups(halves[1], true);
  if (!head || !tail || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

export interface NetworkKeys {
  /** IPv4 address or IPv6 /64: request quota and install issuance. */
  net: string;
  /** IPv6 /48 only: install issuance. */
  net48: string | null;
}

export async function networkKeys(network: CanonicalNetwork, day: string, ipHashKey: Uint8Array): Promise<NetworkKeys> {
  const hash = async (prefix: string) => base64UrlEncode((await hmacSha256(ipHashKey, `${day}:${prefix}`)).slice(0, 16));
  return {
    net: await hash(network.prefix),
    net48: network.family === 6 ? await hash(network.prefix48) : null
  };
}

/** Rate-limit binding key: not stored, but hashed anyway so no raw IP leaves the isolate. */
export async function rateLimitKey(network: CanonicalNetwork, day: string, ipHashKey: Uint8Array): Promise<string> {
  return base64UrlEncode((await hmacSha256(ipHashKey, `rl:${day}:${network.prefix}`)).slice(0, 12));
}
