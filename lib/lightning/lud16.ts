import { isAllowedHostname } from "@/lib/lightning/host";

const LUD16_LOCAL_PATTERN = /^[a-z0-9-_.]+$/;

export function parseLud16(value: string): { name: string; domain: string } | null {
  const trimmed = value.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const name = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (!LUD16_LOCAL_PATTERN.test(name)) return null;
  if (!isAllowedHostname(domain)) return null;

  return { name, domain };
}

export function lud16WellKnownUrl(name: string, domain: string): string {
  return `https://${domain}/.well-known/lnurlp/${name}`;
}
