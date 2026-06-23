"use client";

import { MessageCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
  useReadContracts,
} from "wagmi";

import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import type { PassportStatus } from "@/lib/types/ponder";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type DelistPhase = "idle" | "wallet" | "tx";

type ActiveListing = {
  active: true;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
};

type ListingProp = {
  active: boolean;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
};

type Props = {
  chainId: number;
  tokenId: string;
  listing: ListingProp | null;
  /** Current passport holder (marketplace contract while listed). */
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

function parseOnChainListing(raw: unknown): {
  seller: `0x${string}`;
  fiatPrice1e8: bigint;
  fiat: number;
  active: boolean;
} | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw) && "seller" in raw) {
    const o = raw as {
      seller: `0x${string}`;
      fiatPrice1e8: bigint;
      fiat: number;
      active: boolean;
    };
    return {
      seller: o.seller,
      fiatPrice1e8: o.fiatPrice1e8,
      fiat: Number(o.fiat),
      active: Boolean(o.active),
    };
  }
  if (Array.isArray(raw) && raw.length >= 4) {
    return {
      seller: raw[0] as `0x${string}`,
      fiatPrice1e8: raw[1] as bigint,
      fiat: Number(raw[2]),
      active: Boolean(raw[3]),
    };
  }
  return null;
}

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

  const { data: chainReads, isLoading: isChainListingLoading } = useReadContracts({
    contracts: market
      ? [
          {
            address: market,
            abi: MarketplaceEscrowAbi,
            functionName: "listings",
            args: [tid],
          },
        ]
      : [],
  });

  const chainRow = parseOnChainListing(chainReads?.[0]?.result);

  const effectiveListing = useMemo((): ActiveListing | null => {
    if (chainRow?.active) {
      return {
        active: true,
        fiatPrice1e8: String(chainRow.fiatPrice1e8),
        fiatCurrency: chainRow.fiat,
        seller: chainRow.seller,
      };
    }
    if (listing?.active) {
      return {
        active: true,
        fiatPrice1e8: listing.fiatPrice1e8,
        fiatCurrency: listing.fiatCurrency,
        seller: listing.seller,
      };
    }
    return null;
  }, [chainRow, listing]);

  const contactPeer: `0x${string}` = effectiveListing?.active
    ? effectiveListing.seller
    : passportOwner;
  const isSelf =
    Boolean(address) &&
    address!.toLowerCase() === contactPeer.toLowerCase();

  const isSeller = Boolean(
    effectiveListing?.active &&
    address &&
    effectiveListing.seller &&
    address.toLowerCase() === effectiveListing.seller.toLowerCase(),
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
      {effectiveListing?.active ? (
        <>
          <ListingBuyPanel
            chainId={chainId}
            tokenId={tokenId}
            listing={effectiveListing}
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
      ) : isChainListingLoading && market ? (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          Checking listing…
        </p>
      ) : (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          Not currently listed
        </p>
      )}

      {contactPeer && !isSelf && !isSeller && (
        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <SellerContactButton
              peerAddress={contactPeer}
              label="Message seller"
              listingTokenId={effectiveListing?.active ? tokenId : null}
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
