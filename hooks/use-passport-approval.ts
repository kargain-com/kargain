"use client";

/**
 * Sole owner of ERC-721 passport approval reads/writes for any spender
 * (commerce modes, bridge gateway). ERC-20 payment-token allowance is a
 * different rule — do not fold it here.
 *
 * Callers pass `awaitReceipt` from their `useTxSync` so nested approve inside
 * `runTx` / `runFlow` keeps a single phase owner.
 */

import { useCallback, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";

import { addressesMatch } from "@/lib/commerce/consignment";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export type PassportApprovalStep = "idle" | "approving" | "ready";

type AwaitReceipt = (hash: `0x${string}`) => Promise<unknown>;

type Args = {
  chainId: number;
  tokenId: string;
  /** Contract that must be allowed to move this passport (mode or gateway). */
  spender: `0x${string}` | undefined;
  enabled?: boolean;
};

export function usePassportApproval({
  chainId,
  tokenId,
  spender,
  enabled = true,
}: Args) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [approvalBusy, setApprovalBusy] = useState(false);

  const passport = karPassportAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tokenIdBig = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const readsEnabled = Boolean(
    enabled && passport && spender && address && tokenId,
  );

  const contracts = useMemo(() => {
    if (!readsEnabled || !passport || !spender || !address) return [];
    return [
      {
        key: "getApproved" as const,
        address: passport,
        abi: KarPassportAbi,
        functionName: "getApproved",
        args: [tokenIdBig] as const,
        chainId: wc,
      },
      {
        key: "isApprovedForAll" as const,
        address: passport,
        abi: KarPassportAbi,
        functionName: "isApprovedForAll",
        args: [address, spender] as const,
        chainId: wc,
      },
    ];
  }, [readsEnabled, passport, spender, address, tokenIdBig, wc]);

  const reads = useKeyedReadContracts({
    contracts,
    query: {
      enabled: readsEnabled,
      staleTime: 30_000,
    },
  });

  const approvedForTokenEntry = reads.entry("getApproved");
  const approvedForAllEntry = reads.entry("isApprovedForAll");

  const approvedForToken =
    approvedForTokenEntry?.status === "success" &&
    typeof approvedForTokenEntry.result === "string" &&
    spender != null &&
    addressesMatch(approvedForTokenEntry.result, spender);

  const approvedForAll =
    approvedForAllEntry?.status === "success" &&
    approvedForAllEntry.result === true;

  /** `undefined` while unread or disabled — fail closed for derivation. */
  const isApproved: boolean | undefined = !readsEnabled
    ? undefined
    : approvedForTokenEntry == null || approvedForAllEntry == null
      ? undefined
      : approvedForTokenEntry.status === "failure" &&
          approvedForAllEntry.status === "failure"
        ? undefined
        : Boolean(approvedForToken || approvedForAll);

  const needsApproval = isApproved === false;

  const step: PassportApprovalStep = approvalBusy
    ? "approving"
    : isApproved === true
      ? "ready"
      : "idle";

  const approveForAll = useCallback(
    async (awaitReceipt: AwaitReceipt) => {
      if (!passport || !spender) return;
      setApprovalBusy(true);
      try {
        const hash = await writeContractAsync({
          address: passport,
          abi: KarPassportAbi,
          functionName: "setApprovalForAll",
          args: [spender, true],
          chainId: wc,
        });
        await awaitReceipt(hash);
        await reads.refetch();
      } finally {
        setApprovalBusy(false);
      }
    },
    [passport, spender, writeContractAsync, wc, reads],
  );

  const approveToken = useCallback(
    async (awaitReceipt: AwaitReceipt) => {
      if (!passport || !spender) return;
      setApprovalBusy(true);
      try {
        const hash = await writeContractAsync({
          address: passport,
          abi: KarPassportAbi,
          functionName: "approve",
          args: [spender, tokenIdBig],
          chainId: wc,
        });
        await awaitReceipt(hash);
        await reads.refetch();
      } finally {
        setApprovalBusy(false);
      }
    },
    [passport, spender, tokenIdBig, writeContractAsync, wc, reads],
  );

  /** Ensure-then-act: grant operator-wide if not already approved either way. */
  const ensureApproved = useCallback(
    async (awaitReceipt: AwaitReceipt) => {
      if (isApproved) return;
      await approveForAll(awaitReceipt);
    },
    [isApproved, approveForAll],
  );

  return {
    /** Token or spender-for-all; `undefined` while unread. */
    isApproved,
    approvedForToken,
    approvedForAll,
    needsApproval,
    /** Declarative step for button labels — do not re-derive in callers. */
    step,
    approvalBusy,
    ensureApproved,
    approveForAll,
    approveToken,
    refetch: reads.refetch,
  };
}
