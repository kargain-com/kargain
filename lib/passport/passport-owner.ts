export function isSameWallet(
  a?: string | null,
  b?: string | null,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function resolveEffectiveOnChainOwner(
  onChainOwner?: `0x${string}` | null,
  ponderOwner?: `0x${string}` | null,
): `0x${string}` | undefined {
  return onChainOwner ?? ponderOwner ?? undefined;
}

export function isOnChainNftOwner(
  address?: string | null,
  onChainOwner?: `0x${string}` | null,
): boolean {
  return isSameWallet(address, onChainOwner);
}

type PassportHolderInput = {
  address?: string | null;
  onChainOwner?: `0x${string}` | null;
  ponderOwner?: `0x${string}` | null;
  listingActive?: boolean;
  listingSeller?: `0x${string}` | null;
};

export function isPassportHolder({
  address,
  onChainOwner,
  ponderOwner,
  listingActive,
  listingSeller,
}: PassportHolderInput): boolean {
  if (!address) return false;

  if (listingActive && listingSeller) {
    return isSameWallet(address, listingSeller);
  }

  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, ponderOwner);
  return isOnChainNftOwner(address, effectiveOwner);
}
