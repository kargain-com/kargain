import {
  buildPonderUrl,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { isCommercialChainId } from "@/lib/web3/commercial-active";
import {
  readActiveVerifierMemberships,
  verifierMembershipKey,
} from "@/lib/kar-pro/is-active-verifier-commercial";
import { getAddress } from "viem";

export type ProShowroomSlugCandidate = {
  chainId: number;
  address: `0x${string}`;
  name: string;
  slug: string;
};

export type ResolveProShowroomBySlugResult =
  | { kind: "resolved"; chainId: number; address: `0x${string}` }
  | { kind: "ambiguous"; candidates: ProShowroomSlugCandidate[] }
  | { kind: "missing" };

type BySlugWire = {
  address?: string;
  chainId?: number;
  identity?: { name?: string; slug?: string };
  name?: string;
  slug?: string;
};

async function fetchBySlugOnChain(
  slug: string,
  chainId: number,
): Promise<ProShowroomSlugCandidate | null> {
  try {
    const url = buildPonderUrl(
      "verifiers.bySlug",
      { slug },
      { chainId },
    );
    const res = await ponderFetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as BySlugWire;
    if (!data.address) return null;
    const address = getAddress(data.address);
    const wireChain =
      typeof data.chainId === "number" && data.chainId > 0
        ? data.chainId
        : chainId;
    return {
      chainId: wireChain,
      address,
      name: String(data.identity?.name ?? data.name ?? "").trim(),
      slug: String(data.identity?.slug ?? data.slug ?? slug).trim() || slug,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve showroom membership for a slug.
 * With chain: that membership only. Without: probe each commercial chain —
 * unique → resolved; multiple → ambiguous (never silent limit(1)); zero → missing.
 */
export async function resolveProShowroomBySlug(
  slug: string,
  chainId: number | null,
): Promise<ResolveProShowroomBySlugResult> {
  const trimmed = slug.trim();
  if (!trimmed) return { kind: "missing" };

  if (chainId != null) {
    if (!isCommercialChainId(chainId)) return { kind: "missing" };
    const hit = await fetchBySlugOnChain(trimmed, chainId);
    if (!hit) return { kind: "missing" };
    return { kind: "resolved", chainId: hit.chainId, address: hit.address };
  }

  const chainIds = commercialChainIds();
  const hits = (
    await Promise.all(chainIds.map((id) => fetchBySlugOnChain(trimmed, id)))
  ).filter((h): h is ProShowroomSlugCandidate => h != null);

  if (hits.length === 0) return { kind: "missing" };
  if (hits.length === 1) {
    return {
      kind: "resolved",
      chainId: hits[0]!.chainId,
      address: hits[0]!.address,
    };
  }
  return {
    kind: "ambiguous",
    candidates: hits.sort((a, b) => a.chainId - b.chainId),
  };
}

/** Membership-keyed active on one chain (not commercial OR). */
export async function isActiveVerifierOnChain(
  address: `0x${string}`,
  chainId: number,
): Promise<boolean> {
  const batch = await readActiveVerifierMemberships([{ address, chainId }]);
  if (batch.status === "failure") return false;
  return (
    batch.activeByMembership.get(verifierMembershipKey(chainId, address)) ===
    true
  );
}
