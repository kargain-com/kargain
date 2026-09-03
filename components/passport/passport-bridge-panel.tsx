"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReadContract } from "wagmi";

import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { Button } from "@/components/ui/button";
import { InstrumentLink } from "@/components/ui/instrument-link";
import { useBridge } from "@/hooks/use-bridge";
import { useBridgeTransit } from "@/hooks/use-bridge-transit";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { CommerceMode } from "@/lib/commerce/mode";
import type { EncumbrancePermissionGate } from "@/lib/passport/encumbrance-permission";
import {
  BRIDGE_SECOND_HOP_REQUIRED,
  bridgeActionCopy,
  bridgeBlockReasonCopy,
  bridgeHopIdLine,
  deriveBridgeCrossingConsent,
  deriveBridgeDirectionMode,
  deriveBridgeSurface,
} from "@/lib/passport/bridge-surface";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import { parsePassportTokenId } from "@/lib/passport/passport-token-id";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  bridgeCounterpartChainId,
  resolveBridgeRoute,
} from "@/lib/web3/bridge";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { formatNativeAmountLabeled } from "@/lib/web3/native-amount";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  /** Fold incomplete cause — answered by bridge-surface (§4.21). */
  custodyUnresolved?: string | null;
  /**
   * On-chain lock when read. `undefined` = not read — never invent `false`.
   */
  custodyLocked?: boolean;
  /** `may(tokenId, LeaveChain)` gate from commerce facts. */
  leaveChainPermission: EncumbrancePermissionGate;
  /** Mode holding a live consignment, when one does — drives block copy. */
  liveConsignmentMode: CommerceMode | null;
  /** Bonded verification challenge open on the passport. */
  challengeOpen: boolean | undefined;
};

export function PassportBridgePanel({
  chainId,
  tokenId,
  passportOwner,
  passportStatus,
  custodyUnresolved,
  custodyLocked,
  leaveChainPermission,
  liveConsignmentMode,
  challengeOpen,
}: Props) {
  const router = useRouter();
  const handedOffRef = useRef(false);
  const [crossingAcked, setCrossingAcked] = useState(false);
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const passport = karPassportAddress(chainId);
  const tid = BigInt(tokenId);
  const dstChainId = bridgeCounterpartChainId(chainId);
  const dstName = dstChainId != null ? shortChainName(dstChainId) : null;
  const originChainId = parsePassportTokenId(tokenId).chainId;
  const directionMode = deriveBridgeDirectionMode({
    custodyChainId: chainId,
    originChainId,
  });
  const actionCopy = dstName
    ? bridgeActionCopy(directionMode, dstName)
    : null;
  const crossingConsent = deriveBridgeCrossingConsent(passportStatus);

  const { record, ui, scanUrl: transitScanUrl, transitActive } =
    useBridgeTransit({
      tokenId,
      ponderCustodyChain: chainId,
    });

  const { data: onChainOwner, status: ownerStatus } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "ownerOf",
    args: [tid],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(passport) && !transitActive },
  });

  const effectiveOwner = resolveEffectiveOnChainOwner(
    ownerStatus === "success"
      ? (onChainOwner as `0x${string}`)
      : undefined,
    passportOwner,
  );
  const isOwner =
    ownerStatus === "success" && isOnChainNftOwner(address, effectiveOwner);

  const surface = deriveBridgeSurface({
    isOwner: Boolean(isOwner),
    chainId,
    leaveChainPermission,
    liveConsignmentMode,
    challengeOpen: challengeOpen === true,
    transitActive,
    custodyUnresolved: custodyUnresolved ?? null,
    custodyLocked,
    ponderCustodyChain: chainId,
  });

  const {
    quote,
    bridge,
    phase,
    feeWei,
    scanUrl: liveScanUrl,
    busy,
    error,
    configured,
  } = useBridge(
    chainId,
    dstChainId ?? chainId,
    tokenId,
  );

  const scanUrl = liveScanUrl ?? transitScanUrl;

  useEffect(() => {
    if (!surface.canBridge || !configured || transitActive) return;
    void quote(tid);
  }, [surface.canBridge, configured, quote, tid, transitActive]);

  // Soft-nav to destination URL once on-chain delivery is confirmed.
  // Working commerce UI returns after indexer catch-up → syncReads (transit hook).
  useEffect(() => {
    if (handedOffRef.current) return;
    const dst = record?.dstChainId ?? null;
    const ready =
      record?.phase === "indexer_catchup" ||
      record?.phase === "delivered_on_chain";
    if (!ready || dst == null) return;
    handedOffRef.current = true;
    router.replace(`/marketplace/${tokenId}?chain=${dst}`);
  }, [record?.dstChainId, record?.phase, router, tokenId]);

  if (!surface.visible) return null;

  const disabledReason =
    surface.locationCopy != null
      ? surface.locationCopy
      : surface.blockReason != null
      ? bridgeBlockReasonCopy(
          surface.blockReason,
          surface.unanswerableSource,
        )
      : !configured || dstChainId == null
        ? "Bridge is not configured on this chain."
        : null;

  const inTransitUi = transitActive && ui != null;
  const displayDstName =
    record != null ? shortChainName(record.dstChainId) : dstName;

  // Every hop the route takes — a two-hop move is stated before the send.
  const route =
    dstChainId != null ? resolveBridgeRoute(chainId, dstChainId) : null;
  const hopLines =
    record != null
      ? [bridgeHopIdLine(record.srcChainId, record.dstChainId)]
      : route?.ok
        ? route.hops.map((hop) =>
            bridgeHopIdLine(hop.srcChainId, hop.dstChainId),
          )
        : [];
  const multiHop = record == null && route?.ok === true && route.hops.length > 1;

  const buttonLabel =
    phase === "approving"
      ? "Approving…"
      : phase === "quoting" || phase === "sending"
        ? "Bridging…"
        : phase === "pending" ||
            record?.phase === "in_flight" ||
            record?.phase === "source_confirmed"
          ? "Waiting for delivery…"
          : record?.phase === "indexer_catchup" ||
              record?.phase === "delivered_on_chain"
            ? displayDstName
              ? `Delivered on ${displayDstName}`
              : "Delivered"
            : (actionCopy?.idleButton ?? "Bridge");

  return (
    <section className="space-y-3 rounded-md border border-border-default bg-bg-card p-4">
      <h2 className="font-sans text-base font-medium text-text-primary">
        {inTransitUi ? ui.title : (actionCopy?.title ?? "Bridge")}
      </h2>
      <p className="font-sans text-sm text-text-secondary">
        {inTransitUi
          ? ui.description
          : (actionCopy?.description ??
            "Bridge is not available on this network.")}
      </p>

      {inTransitUi && (
        <ol className="space-y-1.5" aria-label="Bridge progress">
          {ui.stepLabels.map((label, index) => (
            <li
              key={label}
              className={cn(
                "font-mono text-xs tabular-nums",
                index <= ui.stepIndex
                  ? "text-text-primary"
                  : "text-text-tertiary",
              )}
            >
              {index <= ui.stepIndex ? "●" : "○"} {label}
            </li>
          ))}
        </ol>
      )}

      {multiHop && (
        <p className="font-sans text-sm text-text-secondary" role="status">
          {BRIDGE_SECOND_HOP_REQUIRED}
        </p>
      )}

      {hopLines.length > 0 && (
        <ol aria-label="Bridge hops">
          {hopLines.map((line) => (
            <li
              key={line}
              className="font-mono text-xs tabular-nums text-text-tertiary"
            >
              {line}
            </li>
          ))}
        </ol>
      )}

      {surface.canBridge && !transitActive && (
        <div className="space-y-2">
          <p className="font-sans text-sm text-text-secondary">
            {crossingConsent.disclosure}
          </p>
          {crossingConsent.requiresAck ? (
            <label className="flex items-start gap-2 font-sans text-sm text-text-primary">
              <input
                type="checkbox"
                className="mt-1"
                checked={crossingAcked}
                onChange={(e) => setCrossingAcked(e.target.checked)}
              />
              <span>
                I understand verification will not travel and this passport will
                be unverified after the crossing.
              </span>
            </label>
          ) : null}
        </div>
      )}

      {feeWei != null && surface.canBridge && !transitActive && (
        <dl className="flex items-baseline justify-between gap-3">
          <dt className="font-sans text-sm text-text-secondary">
            Estimated fee
          </dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatNativeAmountLabeled(
              feeWei,
              nativeUnitOf(commercialActive(chainId)!),
            )}
          </dd>
        </dl>
      )}

      {disabledReason && !transitActive && (
        <p className="font-sans text-sm text-text-secondary" role="status">
          {disabledReason}
        </p>
      )}

      {(phase === "pending" ||
        record?.phase === "in_flight" ||
        record?.phase === "source_confirmed") &&
        scanUrl && (
          <p className="font-sans text-sm text-text-secondary" role="status">
            Bridging in progress.{" "}
            <InstrumentLink href={scanUrl} variant="monoSm" external>
              View on LayerZero Scan
            </InstrumentLink>
          </p>
        )}

      {(record?.phase === "indexer_catchup" ||
        record?.phase === "delivered_on_chain") &&
        scanUrl && (
          <p className="font-sans text-sm text-text-secondary" role="status">
            Delivered.{" "}
            <InstrumentLink href={scanUrl} variant="monoSm" external>
              View on LayerZero Scan
            </InstrumentLink>
          </p>
        )}

      {record?.phase === "timed_out" && scanUrl && (
        <p className="font-sans text-sm text-status-error" role="alert">
          Delivery not confirmed in time.{" "}
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

      {evm.ok ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={
            transitActive ||
            !surface.canBridge ||
            Boolean(disabledReason) ||
            busy ||
            (crossingConsent.requiresAck && !crossingAcked)
          }
          onClick={() => {
            void bridge(tid);
          }}
        >
          {buttonLabel}
        </Button>
      ) : (
        <EvmSessionRefusal
          cause={evm.cause}
          disconnectedTitle="Connect your wallet to move this passport."
        />
      )}
    </section>
  );
}
