import { getAddress } from "viem";

import { commerceModeAddresses } from "@/lib/commerce/mode";

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
  const modes = Object.values(commerceModeAddresses(chainId)).map((a) =>
    a.toLowerCase(),
  );

  if (listing?.active && modes.includes(owner.toLowerCase())) {
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
