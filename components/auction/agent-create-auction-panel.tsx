"use client";

import { useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import {
  auctionReserveMeetsOwnerMin,
  isAuctionAuthUsableForCreate,
  MAX_AGENT_FEE_BPS,
  parseAuctionAgentAuthorization,
} from "@/lib/auction/auction-agent";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import {
  auctionAssetLabelFromAddress,
  parseOwnerMinAsset,
} from "@/lib/auction/owner-min-asset";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { computeSellerNet } from "@/lib/marketplace/seller-net";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  auctionEscrowAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  /** Called after successful create. */
  onSuccess?: () => void;
};

const THREE_DAYS = 3 * 24 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function parseCommissionBps(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) return null;
  const bps = Math.round(pct * 100);
  if (bps > MAX_AGENT_FEE_BPS) return null;
  return bps;
}

/**
 * Agent `createAuctionOnBehalf` — asset locked to chain authorization.
 * Chain-reads `auctionAgentAuthorizations` on mount (U2).
 */
export function AgentCreateAuctionPanel({
  chainId,
  tokenId,
  onSuccess,
}: Props) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);

  const [reserveStr, setReserveStr] = useState("");
  const [durationDays, setDurationDays] = useState(3);
  const [commissionInput, setCommissionInput] = useState("");
  const [txError, setTxError] = useState<string | null>(null);
  const busy = phase !== "idle";

  const escrow = auctionEscrowAddress(chainId);
  const usdc = usdcAddress(chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);
  const tid = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const { data: authRaw, isPending: authPending } = useReadContract({
    address: escrow,
    abi: AuctionEscrowAbi,
    functionName: "auctionAgentAuthorizations",
    args: [tid],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(escrow && tokenId) },
  });

  const { data: platformFeeBpsRaw } = useReadContract({
    address: escrow,
    abi: AuctionEscrowAbi,
    functionName: "platformFeeBps",
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(escrow) },
  });

  const auth = useMemo(
    () => parseAuctionAgentAuthorization(authRaw),
    [authRaw],
  );
  const platformFeeBps =
    platformFeeBpsRaw != null ? BigInt(platformFeeBpsRaw) : undefined;
  const nowSec = Math.floor(Date.now() / 1000);
  const usable = isAuctionAuthUsableForCreate(auth, nowSec);

  const isAuthorizedAgent =
    isConnected &&
    Boolean(address && auth) &&
    address!.toLowerCase() === auth!.agent.toLowerCase();

  const assetLabel = auctionAssetLabelFromAddress(auth?.asset);

  const reserve = useMemo(
    () => parseOwnerMinAsset(reserveStr, assetLabel),
    [reserveStr, assetLabel],
  );
  const agentFeeBps = useMemo(
    () => parseCommissionBps(commissionInput) ?? -1,
    [commissionInput],
  );
  const validCommission = agentFeeBps >= 0;

  const meetsMin = auctionReserveMeetsOwnerMin(
    reserve,
    validCommission ? agentFeeBps : -1,
    platformFeeBps,
    auth?.ownerMinAsset ?? 0n,
  );

  const breakdown =
    reserve != null &&
    validCommission &&
    platformFeeBps != null &&
    reserve > 0n
      ? computeSellerNet(reserve, agentFeeBps, platformFeeBps)
      : null;

  if (!escrow) return null;

  if (authPending) {
    return (
      <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
        Loading authorization…
      </p>
    );
  }

  if (!usable || !isAuthorizedAgent || !auth) {
    return (
      <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
        You are not authorized to start an auction for this vehicle, or the
        authorization expired.
      </p>
    );
  }

  async function onCreate() {
    setTxError(null);
    if (!escrow || !auth || !usable) return;

    const durationSec = durationDays * 24 * 60 * 60;
    if (durationSec < THREE_DAYS || durationSec > SEVEN_DAYS) {
      setTxError("Duration must be between 3 and 7 days.");
      return;
    }
    if (reserve == null || reserve <= 0n) {
      setTxError("Enter a valid reserve amount.");
      return;
    }
    if (!validCommission) {
      setTxError("Enter a commission between 0% and 30%.");
      return;
    }
    if (platformFeeBps == null) {
      setTxError("Loading platform fee…");
      return;
    }
    if (!meetsMin) {
      setTxError(
        txErrorMessage(new Error("BelowOwnerMinAsset")),
      );
      return;
    }
    if (assetLabel === "USDC" && !usdc) {
      setTxError("USDC is not configured on this chain.");
      return;
    }

    const succeeded = await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "createAuctionOnBehalf",
        args: [tid, auth.asset, reserve, durationSec, agentFeeBps],
        chainId: wagmiChainId(chainId),
      }),
    );
    if (succeeded) {
      onSuccess?.();
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Start auction on behalf
        </p>
        <p className="mt-2 font-sans text-sm text-text-secondary">
          Currency is locked to{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {assetLabel}
          </span>
          . Owner minimum{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(auth.ownerMinAsset, assetLabel)}
          </span>
          .
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="agent-auction-reserve"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Reserve ({assetLabel})
        </label>
        <input
          id="agent-auction-reserve"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={reserveStr}
          onChange={(e) => setReserveStr(e.target.value)}
          disabled={busy || isWriting}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        />
        <p className="font-sans text-xs text-text-secondary">
          Lowest price the owner will accept. Shown to everyone.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="agent-auction-duration"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Duration (days)
        </label>
        <select
          id="agent-auction-duration"
          value={durationDays}
          onChange={(e) => setDurationDays(Number(e.target.value))}
          disabled={busy || isWriting}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        >
          {[3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="agent-auction-commission"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Your commission (%)
        </label>
        <input
          id="agent-auction-commission"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0–30"
          value={commissionInput}
          onChange={(e) => setCommissionInput(e.target.value)}
          disabled={busy || isWriting}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        />
      </div>

      {breakdown && reserve != null && (
        <p className="rounded-md border border-border-default bg-bg-primary p-3 font-sans text-sm text-text-secondary">
          At reserve{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(reserve, assetLabel)}
          </span>
          : you receive{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(breakdown.agentFee, assetLabel)}
          </span>
          , owner receives{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(breakdown.sellerNet, assetLabel)}
          </span>
          . Your commission is fixed for the whole auction.
        </p>
      )}

      {reserve != null && validCommission && platformFeeBps != null && !meetsMin && (
        <p className="text-sm text-status-error" role="alert">
          At this reserve the owner would receive less than their guaranteed
          minimum. Raise the reserve or lower the commission.
        </p>
      )}

      {wrongChain && (
        <p className="font-sans text-sm text-text-secondary">
          Switch to the correct network to start an auction.
        </p>
      )}

      {(txError ?? error) && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {txError ?? error}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={
          busy ||
          isWriting ||
          !reserveStr.trim() ||
          !validCommission ||
          !meetsMin ||
          platformFeeBps == null
        }
        onClick={() => void onCreate()}
      >
        {phase === "indexing" || busy || isWriting
          ? "Confirming…"
          : "Start auction"}
      </Button>
    </div>
  );
}
