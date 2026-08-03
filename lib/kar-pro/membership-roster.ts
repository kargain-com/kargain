import { shortChainName } from "@/lib/web3/supported-chains";

export type KarProMembershipStatus = "active" | "not_joined" | "unresolved";

export type KarProMembershipRow = {
  chainId: number;
  status: KarProMembershipStatus;
  isCurrentWalletChain: boolean;
};

export type DeriveKarProMembershipRosterInput = {
  commercialChainIds: readonly number[];
  /** Wallet commercial target; null → no row is current. */
  walletChainId: number | null;
  /** `undefined` = unread / unresolved for that chain. */
  activeByChain: ReadonlyMap<number, boolean | undefined>;
};

/**
 * One row per commercial chain. Unread → unresolved (fail closed).
 * Stable sort by chainId ascending.
 */
export function deriveKarProMembershipRoster(
  input: DeriveKarProMembershipRosterInput,
): KarProMembershipRow[] {
  const ids = [...input.commercialChainIds].sort((a, b) => a - b);
  return ids.map((chainId) => {
    const active = input.activeByChain.get(chainId);
    let status: KarProMembershipStatus;
    if (active === undefined) status = "unresolved";
    else if (active === true) status = "active";
    else status = "not_joined";
    return {
      chainId,
      status,
      isCurrentWalletChain:
        input.walletChainId != null && input.walletChainId === chainId,
    };
  });
}

/** Join-time fact: membership is per commercial network. */
export const KAR_PRO_PER_NETWORK_JOIN_DISCLOSURE =
  "KarPro on this network only. Stake, verification fee, and showroom credentials on other networks are separate — switch your wallet and join again to add another network.";

/** Payments section: methods are wallet-global; fee is per network. */
export const KAR_PRO_PAYMENTS_NETWORK_SCOPE =
  "Payment methods apply across networks. Verification fee is set per network on the Fee tab.";

/** Membership leave scope for the current hub chain. */
export function karProLeaveNetworkScopeCopy(chainId: number): string {
  return `This leave applies only to ${shortChainName(chainId)}.`;
}

export function karProNetworkInstrumentLine(chainId: number): string {
  return `Network · ${shortChainName(chainId)}`;
}

export function karProAlreadyActiveElsewhereCopy(chainIds: readonly number[]): string {
  const unique = [...new Set(chainIds)].filter((id) => Number.isFinite(id) && id > 0);
  if (unique.length === 0) return "";
  const names = unique
    .sort((a, b) => a - b)
    .map((id) => shortChainName(id))
    .join(", ");
  return `Already KarPro on ${names}.`;
}

export function otherActiveChainIdsFromRoster(
  rows: readonly KarProMembershipRow[],
  excludeChainId: number | null,
): number[] {
  return rows
    .filter(
      (row) =>
        row.status === "active" &&
        (excludeChainId == null || row.chainId !== excludeChainId),
    )
    .map((row) => row.chainId);
}

/** Pro badge / tab gates: active on any commercial network from roster (not a second OR RPC). */
export function karProAnyActive(rows: readonly KarProMembershipRow[]): boolean {
  return rows.some((row) => row.status === "active");
}

export function activeMembershipChainIds(
  rows: readonly KarProMembershipRow[],
): number[] {
  return rows.filter((row) => row.status === "active").map((row) => row.chainId);
}

/**
 * Prefer wallet commercial when it is an active membership; else first active by chainId sort.
 * No hub invent when none active.
 */
export function preferActiveMembershipChainId(
  rows: readonly KarProMembershipRow[],
  walletCommercialChainId: number | null,
): number | null {
  const active = activeMembershipChainIds(rows);
  if (active.length === 0) return null;
  if (
    walletCommercialChainId != null &&
    active.includes(walletCommercialChainId)
  ) {
    return walletCommercialChainId;
  }
  return active[0] ?? null;
}

/** Enriched facts for one active membership (Ponder detail optional). */
export type KarProActiveMembershipFact = {
  chainId: number;
  slug: string;
  name: string;
  verificationCount: number;
  /** null when detail unread — do not invent fee. */
  verificationFee: bigint | null;
};

/**
 * Fold per-membership keyed reads into address → anyActive.
 * True iff any commercial chain returns true; unread/false → not active (fail closed).
 * Addresses lowercased in the output map.
 */
export function foldAnyActiveByAddress(input: {
  addresses: readonly string[];
  commercialChainIds: readonly number[];
  /** Success true/false; missing → treat as not active for this chain. */
  isActiveOnChain: (chainId: number, addressLower: string) => boolean | undefined;
}): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const raw of input.addresses) {
    const lower = raw.toLowerCase();
    let active = false;
    for (const chainId of input.commercialChainIds) {
      if (input.isActiveOnChain(chainId, lower) === true) {
        active = true;
        break;
      }
    }
    map.set(lower, active);
  }
  return map;
}

/** Key for multi-address membership reads (Commons / peer batches). */
export function karProMembershipActiveKey(
  chainId: number,
  addressLower: string,
): string {
  return `active:${chainId}:${addressLower}`;
}
