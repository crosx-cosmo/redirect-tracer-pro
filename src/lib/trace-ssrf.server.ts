/**
 * SSRF protection for the trace engine.
 *
 * Every destination — the user's input and every hop discovered afterwards —
 * must pass `assertSafeUrl` before a request is made to it. Hostnames are
 * resolved over DNS-over-HTTPS and the resulting addresses are checked against
 * loopback / private / reserved ranges, so a public hostname that points at an
 * internal address is rejected too.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443", "8000"]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".onion"];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

export interface UrlVerdict {
  ok: boolean;
  /** Exact, user-facing reason when `ok` is false. */
  reason: string | null;
  url: URL | null;
  addresses: string[];
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** IPv4 ranges that must never be reachable from the analyzer. */
const V4_BLOCKS: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "unspecified range"],
  ["10.0.0.0", 8, "private network"],
  ["100.64.0.0", 10, "carrier-grade NAT range"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local / cloud metadata range"],
  ["172.16.0.0", 12, "private network"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation range"],
  ["192.168.0.0", 16, "private network"],
  ["198.18.0.0", 15, "benchmarking range"],
  ["198.51.100.0", 24, "documentation range"],
  ["203.0.113.0", 24, "documentation range"],
  ["224.0.0.0", 4, "multicast range"],
  ["240.0.0.0", 4, "reserved range"],
];

export function classifyIp(ip: string): string | null {
  const clean = ip.trim().toLowerCase();

  if (clean.includes(":")) {
    // IPv6
    if (clean === "::" || clean === "::1") return "loopback / unspecified address";
    if (clean.startsWith("::ffff:")) {
      const mapped = clean.slice(7);
      return mapped.includes(".") ? classifyIp(mapped) : "IPv4-mapped address";
    }
    const head = parseInt(clean.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return "unique local address";
    if ((head & 0xffc0) === 0xfe80) return "link-local address";
    return null;
  }

  const value = ipv4ToInt(clean);
  if (value === null) return null;
  for (const [base, bits, label] of V4_BLOCKS) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) return label;
  }
  return null;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

interface DohAnswer {
  Answer?: Array<{ type: number; data: string }>;
}

async function resolve(host: string, type: "A" | "AAAA", timeoutMs: number): Promise<string[]> {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) throw new Error(`DNS lookup returned ${response.status}`);
  const payload = (await response.json()) as DohAnswer;
  const wanted = type === "A" ? 1 : 28;
  return (payload.Answer ?? []).filter((a) => a.type === wanted).map((a) => a.data);
}

export async function assertSafeUrl(raw: string, timeoutMs = 5000): Promise<UrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid absolute URL.", url: null, addresses: [] };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `Blocked: only http and https can be followed (found "${url.protocol.replace(":", "")}").`,
      url,
      addresses: [],
    };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return {
      ok: false,
      reason: `Blocked: port ${url.port} is not allowed.`,
      url,
      addresses: [],
    };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return { ok: false, reason: "Blocked: the URL has no hostname.", url, addresses: [] };
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return {
      ok: false,
      reason: `Blocked: "${host}" is a local or internal hostname.`,
      url,
      addresses: [],
    };
  }

  if (isIpLiteral(host)) {
    const classification = classifyIp(host);
    if (classification) {
      return {
        ok: false,
        reason: `Blocked: ${host} is in a ${classification}.`,
        url,
        addresses: [host],
      };
    }
    return { ok: true, reason: null, url, addresses: [host] };
  }

  let addresses: string[] = [];
  try {
    const [a, aaaa] = await Promise.all([
      resolve(host, "A", timeoutMs).catch(() => [] as string[]),
      resolve(host, "AAAA", timeoutMs).catch(() => [] as string[]),
    ]);
    addresses = [...a, ...aaaa];
  } catch {
    addresses = [];
  }

  if (!addresses.length) {
    return {
      ok: false,
      reason: `Blocked: "${host}" could not be resolved to a public IP address, so it cannot be verified as safe.`,
      url,
      addresses: [],
    };
  }

  for (const address of addresses) {
    const classification = classifyIp(address);
    if (classification) {
      return {
        ok: false,
        reason: `Blocked: "${host}" resolves to ${address}, which is in a ${classification}.`,
        url,
        addresses,
      };
    }
  }

  return { ok: true, reason: null, url, addresses };
}
