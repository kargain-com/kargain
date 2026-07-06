const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

const BLOCKED_TLDS = [".local", ".internal", ".onion"] as const;

function hasBlockedTld(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return BLOCKED_TLDS.some((tld) => lower.endsWith(tld));
}

/** DNS hostname guard shared by LUD-16 and LNURL callback validation. */
export function isAllowedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host || host.length > 253) return false;
  if (host === "localhost") return false;
  if (host.includes("[") || host.includes(":")) return false;
  if (IPV4_PATTERN.test(host)) return false;
  if (hasBlockedTld(host)) return false;
  if (host.endsWith(".")) return false;
  if (!host.includes(".")) return false;

  const labels = host.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) return false;

  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }

  return true;
}
