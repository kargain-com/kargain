/**
 * Sole “is this handle a profile subject on a commercial namespace?” owner.
 * Parses via {@link mintProtocolOwner} only — never viem getAddress / hex invent.
 * No VM-discriminant fork — EVM membership via {@link isCommercialEip155Id}.
 * Session → profile href uses the same resolve path ({@link profileHrefForAccount}).
 */

import type { ActiveAccount } from "@/lib/web3/active-account";
import {
  commercialActive,
  isCommercialEip155Id,
  registeredCommercialNamespaceIds,
  type CommercialActiveStack,
  type CommercialRegistry,
  COMMERCIAL_ACTIVE,
} from "@/lib/web3/commercial-active";
import {
  mintProtocolOwner,
  protocolAddressesEqual,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";
import { isProtocolAddress } from "@/lib/web3/wallet-account";

export type ProfileSubjectResolution =
  | {
      readonly status: "found";
      readonly owner: ProtocolOwner;
      readonly namespaces: readonly number[];
    }
  | { readonly status: "absent" };

/** Address-shaped fields on a commercial stack that are never a user profile. */
function stackIdentityAddressFields(stack: CommercialActiveStack): string[] {
  const out: string[] = [];
  const push = (v: string | undefined) => {
    if (v != null && v.length > 0) out.push(v);
  };
  push(stack.karPassport);
  push(stack.karProPass);
  push(stack.karProStaking);
  push(stack.usdc);
  push(stack.nativeFeed);
  push(stack.eurFeed);
  push(stack.timelock);
  push(stack.forfeitRecipient);
  push(stack.bridgeGateway);
  push(stack.fixedPriceConsignment);
  push(stack.ascendingConsignment);
  push(stack.layerZeroEndpoint);
  push(stack.platformRecipient);
  push(stack.deployer);
  if ("upgradeAuthority" in stack) {
    push(stack.upgradeAuthority);
  }
  return out;
}

/**
 * True when `owner` is a Kargain protocol / denylist / stack identity address
 * on any of the given commercial namespaces — not a person.
 */
export function isCommercialProtocolOwner(
  owner: ProtocolOwner,
  namespaces: readonly number[],
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): boolean {
  for (const ns of namespaces) {
    const stack = commercialActive(ns, registry);
    if (stack == null) continue;
    if (isCommercialEip155Id(ns, registry) && isProtocolAddress(owner, ns)) {
      return true;
    }
    for (const raw of stackIdentityAddressFields(stack)) {
      if (protocolAddressesEqual(ns, owner, raw)) return true;
    }
  }
  return false;
}

/**
 * Resolve a profile URL handle to a commercial-namespace subject.
 * URI-decodes; mints via protocol-address across the commercial registry.
 * Protocol / stack identity addresses → absent (same as today for EVM contracts).
 */
export function resolveProfileSubject(
  rawHandle: string,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): ProfileSubjectResolution {
  const handle = decodeURIComponent(rawHandle).trim();
  if (!handle) return { status: "absent" };

  const namespaces: number[] = [];
  let owner: ProtocolOwner | null = null;
  for (const ns of registeredCommercialNamespaceIds(registry)) {
    const minted = mintProtocolOwner(ns, handle);
    if (minted == null) continue;
    if (owner == null) owner = minted;
    else if (owner !== minted) {
      return { status: "absent" };
    }
    namespaces.push(ns);
  }
  if (owner == null || namespaces.length === 0) {
    return { status: "absent" };
  }
  if (isCommercialProtocolOwner(owner, namespaces, registry)) {
    return { status: "absent" };
  }
  return { status: "found", owner, namespaces };
}

/** First EVM commercial namespace among the subject's namespaces — never invent hub. */
export function profileGuestEvmChainId(
  namespaces: readonly number[],
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): number | null {
  for (const ns of namespaces) {
    if (isCommercialEip155Id(ns, registry)) return ns;
  }
  return null;
}

/**
 * Profile entry href for the connected account — same subject resolve as the route.
 * Disconnected / non-subject → null (Connect chrome / no menu item).
 * Never gates on requireEvmSession: SVM sessions link to their base58 handle.
 */
export function profileHrefForAccount(
  account: ActiveAccount,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): string | null {
  if (account.status !== "connected") return null;
  const subject = resolveProfileSubject(account.address, registry);
  if (subject.status !== "found") return null;
  return `/profile/${encodeURIComponent(subject.owner)}`;
}
