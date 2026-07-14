"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import type { PassportStatus } from "@/lib/types/ponder";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
  passportStatus: PassportStatus;
  onSuccess?: () => void;
};

export function AuctionFinalizePanel({
  chainId,
  tokenId,
  auction,
  passportStatus,
  onSuccess,
}: Props) {
  const router = useRouter();
  const config = useConfig();
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const escrow = auctionEscrowAddress(chainId);
  const useVoid = passportStatus === "UNVERIFIED";
  const finalBid =
    auction.highestBid > 0n
      ? formatAuctionAmount(auction.highestBid, auction.assetLabel)
      : null;

  async function onFinalize() {
    setTxError(null);
    if (!escrow) return;
    setBusy(true);
    try {
      if (walletChainId !== wagmiChainId(chainId)) {
        await switchChainAsync({ chainId: wagmiChainId(chainId) });
      }
      const hash = await writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: useVoid ? "voidAuction" : "settle",
        args: [BigInt(tokenId)],
        chainId: wagmiChainId(chainId),
      });
      await waitForTransactionReceipt(config, { hash });
      onSuccess?.();
      router.refresh();
    } catch (err) {
      setTxError(txErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">
          Auction ended. Anyone can finalize: the vehicle transfers to the winner
          and payment enters a 7-day protection hold.
        </p>
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-primary">
        Auction ended. Anyone can finalize: the vehicle transfers to the winner
        and payment enters a 7-day protection hold.
      </p>
      {finalBid && (
        <p className="font-mono text-sm tabular-nums text-text-primary">
          Final bid {finalBid}
        </p>
      )}
      {useVoid ? (
        <p className="font-sans text-sm text-text-secondary">
          This passport is unverified. Finalize with void to refund every bid
          and return the vehicle to the seller.
        </p>
      ) : (
        <p className="font-sans text-sm text-text-secondary">
          Anyone can finalize — this transfers the vehicle and starts the payout
          hold.
        </p>
      )}
      {txError && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={busy || isPending || !escrow}
        onClick={() => void onFinalize()}
      >
        {busy || isPending
          ? "Confirming…"
          : useVoid
            ? "Void auction"
            : "Finalize auction"}
      </Button>
    </div>
  );
}
