"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useListingOffers } from "@/hooks/use-listing-offers";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { commerceConfirmedLabel } from "@/lib/design/instrument-classes";
import type { ListingOffer } from "@/lib/nostr/listing-offers";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { shortAddress } from "@/lib/web3/wallet-display";
import { formatRelativeTime } from "@/lib/xmtp/helpers";

type Props = {
  chainId: number;
  tokenId: string;
  sellerNostrPubkey: string;
  hasDirectPayment: boolean;
  onConfirmed: () => void;
};

type RowProps = {
  offer: ListingOffer;
  hasDirectPayment: boolean;
  isPanelPending: boolean;
  confirmingBuyer: `0x${string}` | null;
  confirmedBuyer: `0x${string}` | null;
  onStartConfirm: (buyer: `0x${string}`) => void;
  onCancelConfirm: () => void;
  onConfirm: (buyer: `0x${string}`) => void;
};

function ListingOfferRow({
  offer,
  hasDirectPayment,
  isPanelPending,
  confirmingBuyer,
  confirmedBuyer,
  onStartConfirm,
  onCancelConfirm,
  onConfirm,
}: RowProps) {
  const { displayName, isKarPro } = usePeerIdentity(offer.buyerEthAddress);
  const { profile } = useKarProVerifierProfile(offer.buyerEthAddress, {
    isActiveVerifier: isKarPro,
    syncWhileMissing: false,
  });

  const karProName = profile?.name?.trim();
  const label = karProName || displayName || shortAddress(offer.buyerEthAddress);
  const timeLabel = formatRelativeTime(new Date(offer.timestamp * 1000));
  const buyer = offer.buyerEthAddress;
  const isConfirming = confirmingBuyer?.toLowerCase() === buyer.toLowerCase();
  const isConfirmed = confirmedBuyer?.toLowerCase() === buyer.toLowerCase();
  const confirmDisabled =
    isPanelPending || !hasDirectPayment || (confirmingBuyer != null && !isConfirming);

  return (
    <li className="space-y-2 border-t border-border-default pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/profile/${offer.buyerEthAddress}`}
          className="truncate font-sans text-sm text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
        >
          {label}
        </Link>
        <span className="shrink-0 font-sans text-xs text-text-tertiary">{timeLabel}</span>
      </div>

      {isConfirmed ? (
        <p className={commerceConfirmedLabel}>Payment confirmed</p>
      ) : isConfirming ? (
        <div className="space-y-2">
          <p className="font-sans text-xs text-text-secondary">
            Confirm received payment from {shortAddress(buyer)}?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isPanelPending}
              onClick={() => void onConfirm(buyer)}
            >
              Yes, confirm
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPanelPending}
              onClick={onCancelConfirm}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full sm:w-auto"
            disabled={confirmDisabled}
            onClick={() => onStartConfirm(buyer)}
          >
            Confirm payment
          </Button>
          {!hasDirectPayment && (
            <p className="font-sans text-xs text-text-secondary">
              Set payment instructions first.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ListingOffersPanel({
  chainId,
  tokenId,
  sellerNostrPubkey,
  hasDirectPayment,
  onConfirmed,
}: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const [confirmingBuyer, setConfirmingBuyer] = useState<`0x${string}` | null>(null);
  const [confirmedBuyer, setConfirmedBuyer] = useState<`0x${string}` | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const { offers, isLoading } = useListingOffers(tokenId, sellerNostrPubkey);

  const runConfirmPayment = useCallback(
    async (buyer: `0x${string}`) => {
      if (!market || !hasDirectPayment) return;
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      setTxError(null);
      try {
        const hash = await writeContractAsync({
          address: market,
          abi: MarketplaceEscrowAbi,
          functionName: "confirmExternalPayment",
          args: [tid, buyer],
        });
        await waitForTransactionReceipt(config, { hash });
        setConfirmedBuyer(buyer);
        setConfirmingBuyer(null);
        onConfirmed();
      } catch (err) {
        setTxError(txErrorMessage(err));
      }
    },
    [
      market,
      hasDirectPayment,
      wrongChain,
      switchChainAsync,
      wc,
      writeContractAsync,
      tid,
      config,
      onConfirmed,
    ],
  );

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-primary">Buyer offers</p>
      {hasDirectPayment && (
        <p className="font-sans text-xs text-text-secondary">
          Confirming transfers the NFT immediately. Only confirm after you have received
          payment.
        </p>
      )}
      {txError && (
        <p className="text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}
      {isLoading && offers.length === 0 ? (
        <ul className="space-y-3" aria-busy="true" aria-label="Loading offers">
          {[0, 1].map((key) => (
            <li key={key} className="space-y-2 border-t border-border-default pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="h-4 w-32 animate-pulse rounded-sm bg-bg-card" />
                <div className="h-3 w-12 animate-pulse rounded-sm bg-bg-card" />
              </div>
            </li>
          ))}
        </ul>
      ) : offers.length === 0 ? (
        <EmptyState variant="content" level="B" title="No offers yet" />
      ) : (
        <ul className="space-y-3">
          {offers.map((offer) => (
            <ListingOfferRow
              key={offer.eventId}
              offer={offer}
              hasDirectPayment={hasDirectPayment}
              isPanelPending={isPending}
              confirmingBuyer={confirmingBuyer}
              confirmedBuyer={confirmedBuyer}
              onStartConfirm={setConfirmingBuyer}
              onCancelConfirm={() => setConfirmingBuyer(null)}
              onConfirm={runConfirmPayment}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
