"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import type { MarketplaceListingRow } from "@/app/actions/marketplace-listings";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  chainStatusFromGetPassportStatusResult,
  compareListingStatus,
  listingStatusKey,
  pickListingsForChainConfirm,
  type ListingChainStatusDrift,
  type ListingStatusKey,
} from "@/lib/passport/confirm-listing-status";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";

type ConfirmTarget = {
  row: MarketplaceListingRow;
  address: `0x${string}`;
};

function buildConfirmTargets(rows: MarketplaceListingRow[]): ConfirmTarget[] {
  return pickListingsForChainConfirm(rows).flatMap((row) => {
    const address = karPassportAddress(row.chainId);
    if (!address) return [];
    return [{ row, address }];
  });
}

export function useListingChainStatusConfirm(rows: MarketplaceListingRow[]) {
  const targets = useMemo(() => buildConfirmTargets(rows), [rows]);

  const contracts = useMemo(
    () =>
      targets.map(({ row, address }) => ({
        address,
        abi: KarPassportAbi,
        functionName: "getPassportStatus" as const,
        args: [BigInt(row.tokenId)] as const,
        chainId: row.chainId,
      })),
    [targets],
  );

  const { data, isLoading, isFetching } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
    },
  });

  const drifts = useMemo(() => {
    const map = new Map<ListingStatusKey, ListingChainStatusDrift>();
    if (!data) return map;

    targets.forEach(({ row }, index) => {
      const read = data[index];
      if (read?.status !== "success" || read.result == null) return;

      const chainStatus = chainStatusFromGetPassportStatusResult(read.result);
      const drift = compareListingStatus(row.passportStatus, chainStatus);
      if (drift) {
        map.set(listingStatusKey(row.chainId, row.tokenId), drift);
      }
    });

    return map;
  }, [data, targets]);

  return {
    drifts,
    isConfirming: isLoading || isFetching,
  };
}
