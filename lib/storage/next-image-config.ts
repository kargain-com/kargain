/** Irys / Arweave gateway hostnames — keep in sync with `ar-gateway.ts` constants. */
export const CONTENT_IMAGE_DEFAULT_GATEWAY_BASES = [
  "https://gateway.irys.xyz",
  "https://arweave.net",
] as const;

/** Content-addressed Arweave/Irys bytes — same immutability class as metadata. */
export const CONTENT_IMAGE_MINIMUM_CACHE_TTL_SECONDS = 31_536_000;

function hostnameFromGatewayBase(base: string): string | null {
  const trimmed = base.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  try {
    const withProtocol = trimmed.includes("://")
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

/**
 * Hosts allowed for `next/image` remote optimization.
 * Defaults always included; env override host appended when parseable at build.
 *
 * Kept free of `@/` imports so `next.config.ts` can load this module at build.
 */
export function contentImageRemoteHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const hosts = new Set<string>();
  for (const base of CONTENT_IMAGE_DEFAULT_GATEWAY_BASES) {
    const host = hostnameFromGatewayBase(base);
    if (host) hosts.add(host);
  }
  const override =
    env.NEXT_PUBLIC_ARWEAVE_GATEWAY?.trim() ?? env.ARWEAVE_GATEWAY?.trim();
  if (override) {
    const host = hostnameFromGatewayBase(override);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
}

export function contentImageRemotePatterns(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ protocol: "https"; hostname: string; pathname: string }> {
  return contentImageRemoteHosts(env).map((hostname) => ({
    protocol: "https" as const,
    hostname,
    pathname: "/**",
  }));
}
