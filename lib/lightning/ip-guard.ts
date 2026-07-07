export class ForbiddenAddressError extends Error {
  constructor() {
    super("Forbidden address");
    this.name = "ForbiddenAddressError";
  }
}

type ResolvedAddress = { address: string; family: number };

const IPV4_MASK = 0xffffffffn;

const FORBIDDEN_IPV4_RANGES: Array<{ network: bigint; prefix: number }> = [
  { network: 0x00000000n, prefix: 8 }, // 0.0.0.0/8
  { network: 0x0a000000n, prefix: 8 }, // 10.0.0.0/8
  { network: 0x64400000n, prefix: 10 }, // 100.64.0.0/10
  { network: 0x7f000000n, prefix: 8 }, // 127.0.0.0/8
  { network: 0xa9fe0000n, prefix: 16 }, // 169.254.0.0/16
  { network: 0xac100000n, prefix: 12 }, // 172.16.0.0/12
  { network: 0xc0000000n, prefix: 24 }, // 192.0.0.0/24
  { network: 0xc0000200n, prefix: 24 }, // 192.0.2.0/24
  { network: 0xc0a80000n, prefix: 16 }, // 192.168.0.0/16
  { network: 0xc6120000n, prefix: 15 }, // 198.18.0.0/15
  { network: 0xc6336400n, prefix: 24 }, // 198.51.100.0/24
  { network: 0xcb007100n, prefix: 24 }, // 203.0.113.0/24
  { network: 0xe0000000n, prefix: 4 }, // 224.0.0.0/4
  { network: 0xf0000000n, prefix: 4 }, // 240.0.0.0/4
  { network: 0xffffffffn, prefix: 32 }, // 255.255.255.255
];

const FORBIDDEN_IPV6_RANGES: Array<{ network: bigint; prefix: number }> = [
  { network: 0n, prefix: 128 }, // ::
  { network: 1n, prefix: 128 }, // ::1
  { network: 0xfc000000000000000000000000000000n, prefix: 7 }, // fc00::/7
  { network: 0xfe800000000000000000000000000000n, prefix: 10 }, // fe80::/10
  { network: 0xff000000000000000000000000000000n, prefix: 8 }, // ff00::/8
];

function ipv4PrefixMask(prefix: number): bigint {
  if (prefix <= 0) return 0n;
  if (prefix >= 32) return IPV4_MASK;
  return (IPV4_MASK << BigInt(32 - prefix)) & IPV4_MASK;
}

function ipv6PrefixMask(prefix: number): bigint {
  if (prefix <= 0) return 0n;
  if (prefix >= 128) return (1n << 128n) - 1n;
  return ((1n << 128n) - 1n) << BigInt(128 - prefix);
}

function inPrefixV4(value: bigint, network: bigint, prefix: number): boolean {
  const mask = ipv4PrefixMask(prefix);
  return (value & mask) === (network & mask);
}

function inPrefixV6(value: bigint, network: bigint, prefix: number): boolean {
  const mask = ipv6PrefixMask(prefix);
  return (value & mask) === (network & mask);
}

function parseIpv4Octets(address: string): number[] | null {
  const parts = address.trim().split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function ipv4ToBigInt(address: string): bigint | null {
  const octets = parseIpv4Octets(address);
  if (!octets) return null;

  return (
    (BigInt(octets[0]!) << 24n) |
    (BigInt(octets[1]!) << 16n) |
    (BigInt(octets[2]!) << 8n) |
    BigInt(octets[3]!)
  );
}

function expandIpv6Hextets(address: string): string[] | null {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed) return null;

  const zoneIndex = trimmed.indexOf("%");
  const withoutZone = zoneIndex >= 0 ? trimmed.slice(0, zoneIndex) : trimmed;
  if (!withoutZone) return null;

  const doubleColonCount = (withoutZone.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  const [head = "", tail = ""] = withoutZone.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];

  if (headParts.length + tailParts.length > 8) return null;

  const missing = 8 - headParts.length - tailParts.length;
  if (doubleColonCount === 0 && headParts.length + tailParts.length !== 8) return null;

  const hextets = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (hextets.length !== 8) return null;

  for (const part of hextets) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
  }

  return hextets;
}

function ipv6ToBigInt(address: string): bigint | null {
  const hextets = expandIpv6Hextets(address);
  if (!hextets) return null;

  let value = 0n;
  for (const part of hextets) {
    value = (value << 16n) + BigInt(parseInt(part, 16));
  }
  return value;
}

function embeddedIpv4FromMappedV6(address: string): string | null {
  const trimmed = address.trim().toLowerCase();
  const mappedPrefix = "::ffff:";
  if (!trimmed.startsWith(mappedPrefix)) return null;

  const suffix = trimmed.slice(mappedPrefix.length);
  if (suffix.includes(":")) {
    const parts = suffix.split(":");
    if (parts.length !== 2) return null;
    const high = parseInt(parts[0]!, 16);
    const low = parseInt(parts[1]!, 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    if (high < 0 || high > 0xffff || low < 0 || low > 0xffff) return null;
    const octet1 = (high >> 8) & 0xff;
    const octet2 = high & 0xff;
    const octet3 = (low >> 8) & 0xff;
    const octet4 = low & 0xff;
    return `${octet1}.${octet2}.${octet3}.${octet4}`;
  }

  return parseIpv4Octets(suffix) ? suffix : null;
}

function isForbiddenIpv4Value(value: bigint): boolean {
  for (const range of FORBIDDEN_IPV4_RANGES) {
    if (inPrefixV4(value, range.network, range.prefix)) return true;
  }
  return false;
}

function isForbiddenIpv6Value(value: bigint): boolean {
  for (const range of FORBIDDEN_IPV6_RANGES) {
    if (inPrefixV6(value, range.network, range.prefix)) return true;
  }
  return false;
}

/** Unparseable or mismatched input is treated as forbidden (fail-closed). */
export function isForbiddenIp(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    if (value == null) return true;
    return isForbiddenIpv4Value(value);
  }

  const mappedIpv4 = embeddedIpv4FromMappedV6(address);
  if (mappedIpv4) {
    const mappedValue = ipv4ToBigInt(mappedIpv4);
    if (mappedValue == null) return true;
    return isForbiddenIpv4Value(mappedValue);
  }

  const value = ipv6ToBigInt(address);
  if (value == null) return true;
  return isForbiddenIpv6Value(value);
}

export function assertResolvedAddressesAllowed(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0) {
    throw new ForbiddenAddressError();
  }

  for (const entry of addresses) {
    if (entry.family !== 4 && entry.family !== 6) {
      throw new ForbiddenAddressError();
    }
    if (isForbiddenIp(entry.address, entry.family)) {
      throw new ForbiddenAddressError();
    }
  }
}
