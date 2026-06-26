import { getAddress } from "viem";

import { marketplaceAddress } from "@/lib/web3/deployment-addresses";

export type PassportCustody = {
  profileAddress: `0x${string}`;
  custodyAddress?: `0x${string}`;
  isEscrowed: boolean;
};

type ResolvePassportCustodyInput = {
  chainId: number;
  passportOwner: `0x${string}`;
  listing?: {
    active: boolean;
    seller: `0x${string}`;
  } | null;
};

export function resolvePassportCustody({
  chainId,
  passportOwner,
  listing,
}: ResolvePassportCustodyInput): PassportCustody {
  const owner = getAddress(passportOwner);
  const market = marketplaceAddress(chainId);

  if (
    listing?.active &&
    market &&
    owner.toLowerCase() === market.toLowerCase()
  ) {
    return {
      profileAddress: getAddress(listing.seller),
      custodyAddress: owner,
      isEscrowed: true,
    };
  }

  return {
    profileAddress: owner,
    isEscrowed: false,
  };
}
