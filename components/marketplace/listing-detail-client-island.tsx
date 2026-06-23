"use client";

import { MessageCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import type { PassportStatus } from "@/lib/types/ponder";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type DelistPhase = "idle" | "wallet" | "tx";

type Props = {
  chainId: number;
  tokenId: string;
  listing: {
    active: boolean;
    fiatPrice1e8: string;
    fiatCurrency: number;
    seller: `0x${string}`;
  } | null;
  /** Current passport holder (marketplace contract while listed). */
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

export function ListingDetailClientIsland({
  chainId,
  tokenId,
  listing,
  passportOwner,
  passportStatus,
  duplicateVin,
  hadDispute,
}: Props) {
  const config = useConfig();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [delistPhase, setDelistPhase] = useState<DelistPhase>("idle");
  const [delistError, setDelistError] = useState<string | null>(null);

  const market = marketplaceAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;
  const tid = BigInt(tokenId);

  const contactPeer: `0x${string}` = listing?.active ? listing.seller : passportOwner;
  const isSelf =
    Boolean(address) &&
    address!.toLowerCase() === contactPeer.toLowerCase();

  const isSeller = Boolean(
    listing?.active &&
    address &&
    listing.seller &&
    address.toLowerCase() === listing.seller.toLowerCase(),
  );

  const delistLabel =
    delistPhase === "wallet"
      ? "Confirm in wallet…"
      : delistPhase === "tx"
        ? "Delisting…"
        : "Delist";

  const runDelist = useCallback(async () => {
    if (!market || delistPhase !== "idle") return;
    setDelistError(null);
    setDelistPhase("wallet");
    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "delist",
        args: [tid],
      });
      setDelistPhase("tx");
      await waitForTransactionReceipt(config, { hash });
      router.push(`/marketplace/${tokenId}?chain=${chainId}`);
    } catch (err) {
      setDelistPhase("idle");
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as Error).message)
          : "Delist failed";
      setDelistError(msg);
    }
  }, [
    chainId,
    config,
    delistPhase,
    market,
    router,
    switchChainAsync,
    tid,
    tokenId,
    wc,
    wrongChain,
    writeContractAsync,
  ]);

  return (
    <div className="space-y-6">
      {listing?.active ? (
        <>
          <ListingBuyPanel
            chainId={chainId}
            tokenId={tokenId}
            listing={listing}
            passportStatus={passportStatus}
            duplicateVin={duplicateVin}
            hadDispute={hadDispute}
          />
          {isSeller && (
            <div className="mt-4 space-y-3 border-t border-border-default pt-4">
              <button
                type="button"
                disabled={delistPhase !== "idle" || !market}
                onClick={() => void runDelist()}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-status-error bg-transparent font-sans text-sm font-medium text-status-error transition-colors duration-200 hover:bg-status-error/10 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                {delistLabel}
              </button>
              {delistError && (
                <p className="font-sans text-xs text-status-error">{delistError}</p>
              )}
              <Link
                href={`/marketplace/${tokenId}/edit?chain=${chainId}`}
                className="block font-sans text-xs text-text-secondary underline-offset-2 transition-colors duration-200 hover:text-text-primary hover:underline"
              >
                Edit price
              </Link>
            </div>
          )}
        </>
      ) : (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          Not currently listed
        </p>
      )}

      {contactPeer && !isSelf && (
        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <SellerContactButton
              peerAddress={contactPeer}
              label="Message seller"
              listingTokenId={listing?.active ? tokenId : null}
            />
          ) : (
            <button
              type="button"
              disabled
              aria-label="Message seller"
              className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-sm border border-border-default bg-transparent px-7 py-3.5 font-sans text-sm font-medium text-text-secondary opacity-50 disabled:pointer-events-none"
            >
              <MessageCircle size={16} strokeWidth={1.5} aria-hidden />
              Message seller
            </button>
          )}
        </div>
      )}
    </div>
  );
}
