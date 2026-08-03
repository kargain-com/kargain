import {
  readActiveVerifierMemberships,
  verifierMembershipKey,
  type ReadChainVerifierActive,
} from "@/lib/kar-pro/is-active-verifier-commercial";
import {
  deriveKarProMembershipRoster,
  type KarProActiveMembershipFact,
  type KarProMembershipRow,
} from "@/lib/kar-pro/membership-roster";
import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import { mapVerifierDetailToProfile } from "@/lib/verifier/map-verifier-profile";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { parseWeiString } from "@/lib/web3/parse-wei-string";

export type LoadMembershipRosterResult = {
  rows: KarProMembershipRow[];
  /** Active rows with optional Ponder enrichment (fee/slug/count). */
  activeFacts: KarProActiveMembershipFact[];
};

function activeByChainFromMembershipBatch(
  address: `0x${string}`,
  chainIds: readonly number[],
  batch: Awaited<ReturnType<typeof readActiveVerifierMemberships>>,
): Map<number, boolean | undefined> {
  const activeByChain = new Map<number, boolean | undefined>();
  if (batch.status === "failure") {
    for (const chainId of chainIds) {
      activeByChain.set(chainId, undefined);
    }
    return activeByChain;
  }
  for (const chainId of chainIds) {
    const key = verifierMembershipKey(chainId, address);
    if (!batch.activeByMembership.has(key)) {
      // Chain not in usable set → unresolved (fail closed)
      activeByChain.set(chainId, undefined);
    } else {
      activeByChain.set(chainId, batch.activeByMembership.get(key) === true);
    }
  }
  return activeByChain;
}

/**
 * RSC/server roster for a wallet: membership-keyed chain reads → derive.
 * Total batch failure → all unresolved (never invent active).
 */
export async function loadMembershipRoster(
  address: `0x${string}`,
  opts?: {
    walletCommercialChainId?: number | null;
    readChainActive?: ReadChainVerifierActive;
    enrichActive?: boolean;
    fetchDetail?: typeof fetchVerifierDetail;
  },
): Promise<LoadMembershipRosterResult> {
  const chainIds = commercialChainIds();
  const memberships = chainIds.map((chainId) => ({ chainId, address }));
  const batch = await readActiveVerifierMemberships(memberships, {
    readChainActive: opts?.readChainActive,
  });
  const activeByChain = activeByChainFromMembershipBatch(address, chainIds, batch);
  const rows = deriveKarProMembershipRoster({
    commercialChainIds: chainIds,
    walletChainId: opts?.walletCommercialChainId ?? null,
    activeByChain,
  });

  if (opts?.enrichActive === false) {
    return { rows, activeFacts: [] };
  }

  const fetchDetail = opts?.fetchDetail ?? fetchVerifierDetail;
  const activeRows = rows.filter((r) => r.status === "active");
  const activeFacts: KarProActiveMembershipFact[] = await Promise.all(
    activeRows.map(async (row) => {
      const detail = await fetchDetail(address, row.chainId);
      if (detail == null || typeof detail !== "object") {
        return {
          chainId: row.chainId,
          slug: "",
          name: "",
          verificationCount: 0,
          verificationFee: null,
        };
      }
      const profile = mapVerifierDetailToProfile(
        detail as Record<string, unknown>,
        address,
      );
      const rawFee = (detail as Record<string, unknown>).verificationFee;
      const feePresent = rawFee != null && rawFee !== "";
      return {
        chainId: row.chainId,
        slug: profile.slug.trim(),
        name: profile.name.trim(),
        verificationCount: profile.verificationCount,
        verificationFee: feePresent ? parseWeiString(rawFee as string | number | bigint) : null,
      };
    }),
  );

  return { rows, activeFacts };
}

/** Pure map used by tests — membership batch → activeByChain for derive. */
export function mapMembershipBatchToActiveByChain(
  address: `0x${string}`,
  chainIds: readonly number[],
  batch: Awaited<ReturnType<typeof readActiveVerifierMemberships>>,
): Map<number, boolean | undefined> {
  return activeByChainFromMembershipBatch(address, chainIds, batch);
}
