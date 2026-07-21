"use client";

import { useEffect } from "react";
import { formatEther } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { InstrumentLink } from "@/components/ui/instrument-link";
import { useBridge } from "@/hooks/use-bridge";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  bridgeBlockReasonCopy,
  deriveBridgeSurface,
  type BridgeListingState,
} from "@/lib/passport/bridge-surface";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportStatus } from "@/lib/types/ponder";
import { bridgeCounterpartChainId } from "@/lib/web3/bridge";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  listingState: BridgeListingState;
  auctionBlocks: boolean | undefined;
};

export function PassportBridgePanel({
  chainId,
  tokenId,
  passportOwner,
  passportStatus,
  listingState,
  auctionBlocks,
}: Props) {
  const { address, isConnected } = useAccount();
  const passport = karPassportAddress(chainId);
  const tid = BigInt(tokenId);
  const dstChainId = bridgeCounterpartChainId(chainId);
  const dstName = dstChainId != null ? shortChainName(dstChainId) : null;

  const { data: onChainOwner, status: ownerStatus } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "ownerOf",
    args: [tid],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(passport) },
  });

  const effectiveOwner = resolveEffectiveOnChainOwner(
    ownerStatus === "success"
      ? (onChainOwner as `0x${string}`)
      : undefined,
    passportOwner,
  );
  const isOwner =
    isConnected &&
    ownerStatus === "success" &&
    isOnChainNftOwner(address, effectiveOwner);

  const surface = deriveBridgeSurface({
    isOwner: Boolean(isOwner),
    chainId,
    listingState,
    auctionBlocks,
    passportStatus,
  });

  const {
    quote,
    bridge,
    phase,
    feeWei,
    scanUrl,
    busy,
    error,
    configured,
  } = useBridge(
    chainId,
    dstChainId ?? chainId,
  );

  useEffect(() => {
    if (!surface.canBridge || !configured) return;
    void quote(tid);
  }, [surface.canBridge, configured, quote, tid]);

  if (!surface.visible) return null;

  const disabledReason =
    surface.blockReason != null
      ? bridgeBlockReasonCopy(surface.blockReason)
      : !configured || dstChainId == null
        ? "Bridge is not configured on this chain."
        : null;

  const buttonLabel =
    phase === "approving"
      ? "Approving…"
      : phase === "quoting" || phase === "sending"
        ? "Bridging…"
        : phase === "pending"
          ? "Waiting for delivery…"
          : phase === "delivered"
            ? dstName
              ? `Delivered on ${dstName}`
              : "Delivered"
            : dstName
              ? `Move to ${dstName}`
              : "Bridge";

  return (
    <section className="space-y-3 rounded-md border border-border-default bg-bg-card p-4">
      <h2 className="font-sans text-base font-medium text-text-primary">
        Bridge
      </h2>
      <p className="font-sans text-sm text-text-secondary">
        {dstName
          ? `Move this passport to ${dstName} via LayerZero.`
          : "Bridge is not available on this network."}
      </p>
      {dstChainId != null && (
        <p className="font-mono text-xs tabular-nums text-text-tertiary">
          {chainId} → {dstChainId}
        </p>
      )}

      {feeWei != null && surface.canBridge && (
        <dl className="flex items-baseline justify-between gap-3">
          <dt className="font-sans text-sm text-text-secondary">
            Estimated fee
          </dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatEther(feeWei)} ETH
          </dd>
        </dl>
      )}

      {disabledReason && (
        <p className="font-sans text-sm text-text-secondary" role="status">
          {disabledReason}
        </p>
      )}

      {phase === "pending" && scanUrl && (
        <p className="font-sans text-sm text-text-secondary" role="status">
          Bridging in progress.{" "}
          <InstrumentLink href={scanUrl} variant="monoSm" external>
            View on LayerZero Scan
          </InstrumentLink>
        </p>
      )}

      {phase === "delivered" && scanUrl && (
        <p className="font-sans text-sm text-text-secondary" role="status">
          Delivered.{" "}
          <InstrumentLink href={scanUrl} variant="monoSm" external>
            View on LayerZero Scan
          </InstrumentLink>
        </p>
      )}

      {error && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {error}
        </p>
      )}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={
          !surface.canBridge ||
          Boolean(disabledReason) ||
          busy ||
          phase === "delivered"
        }
        onClick={() => {
          void bridge(tid);
        }}
      >
        {buttonLabel}
      </Button>
    </section>
  );
}
