"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { parseUnits, toBytes } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";

import { ListingSellerSettlementPanel } from "@/components/marketplace/listing-seller-settlement-panel";
import { SellerMessagingBanner } from "@/components/marketplace/seller-messaging-banner";
import { Button } from "@/components/ui/button";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { WalletLoginButton } from "@/components/wallet-login-button";
import {
  encodeCurrencyCode,
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { formatFiat1e8, fiatCurrencyLabel } from "@/lib/marketplace/fiat-format";
import { parseOnChainListing } from "@/lib/marketplace/parse-on-chain-listing";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import {
  KarPassportAbi,
  MarketplaceEscrowAbi,
} from "@/lib/contracts/abis.generated";
import {
  karPassportAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  tokenId: string;
  chainId: number;
};

function txErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.length > 160 ? `${err.message.slice(0, 160)}…` : err.message;
  }
  return "Transaction failed.";
}

export function ListingEditClient({ tokenId, chainId }: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const currencyOptions = listingCurrencyCodesForChain(chainId);
  const [priceInput, setPriceInput] = useState("");
  const [askingCurrency, setAskingCurrency] = useState<ListingCurrencyCode>(
    currencyOptions[0] ?? "USD",
  );
  const [settlementNote, setSettlementNote] = useState("");
  const [log, setLog] = useState<string | null>(null);

  const passport = karPassportAddress(chainId);
  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const { data: reads, refetch: refetchReads } = useReadContracts({
    contracts:
      passport && market
        ? [
            {
              address: passport,
              abi: KarPassportAbi,
              functionName: "ownerOf",
              args: [tid],
            },
            {
              address: passport,
              abi: KarPassportAbi,
              functionName: "getApproved",
              args: [tid],
            },
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "listings",
              args: [tid],
            },
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "settlementNotes",
              args: [tid],
            },
          ]
        : [],
  });

  const ownerOf = reads?.[0]?.result as `0x${string}` | undefined;
  const approved = reads?.[1]?.result as `0x${string}` | undefined;
  const listingOnChain = reads?.[2]?.result;
  const settlementNoteRaw = reads?.[3]?.result;
  const refetchListing = refetchReads;

  const row = parseOnChainListing(listingOnChain);
  const active = row?.active ?? false;
  const seller = row?.seller;
  const fiatPrice1e8 = row?.fiatPrice1e8 ?? 0n;
  const listedFiat = row?.fiatCurrency ?? 0;

  const onChainNote = decodeSettlementNote(settlementNoteRaw);

  useEffect(() => {
    if (onChainNote) setSettlementNote(onChainNote);
  }, [onChainNote]);

  const isSeller =
    Boolean(address && seller && address.toLowerCase() === (seller as string).toLowerCase());
  const isOwner =
    Boolean(address && ownerOf && address.toLowerCase() === (ownerOf as string).toLowerCase());

  const canDelist = Boolean(active && isSeller);
  const canList = Boolean(!active && isOwner && address);

  const isApproved =
    Boolean(market && approved && approved.toLowerCase() === market.toLowerCase());

  const saveSettlementNote = useCallback(
    async (note: string) => {
      if (!market || !note.trim()) return;
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "setSettlementNote",
        args: [tid, toBytes(note.trim())],
      });
      await waitForTransactionReceipt(config, { hash });
      await refetchListing();
    },
    [config, market, refetchListing, tid, writeContractAsync],
  );

  const runDelist = useCallback(async () => {
    if (!canDelist || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setLog("Delisting…");
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "delist",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      await refetchListing();
      setLog("Delisted.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [canDelist, wrongChain, market, tid, config, wc, refetchListing, switchChainAsync, writeContractAsync]);

  const runApprove = useCallback(async () => {
    if (!address || !passport || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setLog("Approving marketplace…");
    try {
      const hash = await writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "approve",
        args: [market, tid],
      });
      await waitForTransactionReceipt(config, { hash });
      await refetchListing();
      setLog("Marketplace approved.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [address, wrongChain, passport, market, tid, config, wc, refetchListing, switchChainAsync, writeContractAsync]);

  const runList = useCallback(async () => {
    if (!canList || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    const amount = parseUnits(priceInput || "0", 8);
    if (amount <= 0n) {
      setLog("Enter a valid asking price.");
      return;
    }
    setLog("Listing…");
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "list",
        args: [tid, amount, encodeCurrencyCode(askingCurrency)],
      });
      await waitForTransactionReceipt(config, { hash });
      if (settlementNote.trim()) {
        setLog("Saving payment instructions…");
        await saveSettlementNote(settlementNote);
      }
      await refetchListing();
      setLog("Listed.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [
    canList,
    wrongChain,
    market,
    priceInput,
    askingCurrency,
    settlementNote,
    tid,
    config,
    wc,
    refetchListing,
    saveSettlementNote,
    switchChainAsync,
    writeContractAsync,
  ]);

  const runUpdatePrice = useCallback(async () => {
    if (!canDelist || !market || !passport) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    const amount = parseUnits(priceInput || "0", 8);
    if (amount <= 0n) {
      setLog("Enter a valid asking price.");
      return;
    }
    setLog("Updating price (delist + relist)…");
    try {
      let hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "delist",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      if (!isApproved) {
        hash = await writeContractAsync({
          address: passport,
          abi: KarPassportAbi,
          functionName: "approve",
          args: [market, tid],
        });
        await waitForTransactionReceipt(config, { hash });
      }
      hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "list",
        args: [tid, amount, encodeCurrencyCode(askingCurrency)],
      });
      await waitForTransactionReceipt(config, { hash });
      if (settlementNote.trim()) {
        setLog("Saving payment instructions…");
        await saveSettlementNote(settlementNote);
      }
      await refetchListing();
      setLog("Price updated.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [
    canDelist,
    wrongChain,
    market,
    passport,
    priceInput,
    askingCurrency,
    settlementNote,
    isApproved,
    tid,
    config,
    wc,
    refetchListing,
    saveSettlementNote,
    switchChainAsync,
    writeContractAsync,
  ]);

  const runSaveSettlementNote = useCallback(async () => {
    if (!active || !isSeller || !market) return;
    if (!settlementNote.trim()) {
      setLog("Enter direct payment instructions.");
      return;
    }
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setLog("Saving payment instructions…");
    try {
      await saveSettlementNote(settlementNote);
      setLog("Payment instructions saved.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [
    active,
    isSeller,
    market,
    settlementNote,
    wrongChain,
    wc,
    saveSettlementNote,
    switchChainAsync,
  ]);

  if (!isConnected) {
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
        <p className="text-sm text-text-secondary">Connect wallet to manage this listing.</p>
        <WalletLoginButton />
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Switch to Base Sepolia</p>
        <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
          Switch to Base Sepolia
        </Button>
      </div>
    );
  }

  if (!passport || !market) {
    return <p className="text-sm text-text-secondary">Contracts not configured for this chain.</p>;
  }

  if (!isSeller && !isOwner) {
    return (
      <p className="text-sm text-text-secondary">
        Only the seller (while listed) or the NFT owner (when not listed) can manage this listing.
      </p>
    );
  }

  const displayCurrency = fiatCurrencyLabel(listedFiat);

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium text-text-primary">Manage listing</h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>← Back to passport</Link>
        </Button>
      </div>

      <section className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-4">
        <p className="text-xs text-text-secondary">Token</p>
        <PassportIdLabel tokenId={tokenId} chainId={chainId} prefix="none" variant="mono" className="text-sm text-text-primary" />
        {active ? (
          <>
            <p className="text-xs text-text-secondary pt-2">Asking price</p>
            <p className="text-lg font-medium text-accent-warm">
              {formatFiat1e8(fiatPrice1e8)} {displayCurrency}
            </p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Not currently listed</p>
        )}
      </section>

      {active && isSeller && <SellerMessagingBanner />}

      {active && isSeller && (
        <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">Delist</h2>
          <Button
            type="button"
            variant="outline"
            className="border-status-error text-status-error hover:bg-bg-surface"
            disabled={isPending}
            onClick={() => void runDelist()}
          >
            Delist
          </Button>
        </section>
      )}

      {active && isSeller && (
        <section className="space-y-4 rounded-md border border-accent-warm/40 bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">Update asking price</h2>
          <p className="text-xs text-text-secondary">
            The contract delists and relists in one action (two on-chain steps).
          </p>
          <ListingSellerSettlementPanel
            chainId={chainId}
            priceInput={priceInput}
            onPriceInputChange={setPriceInput}
            askingCurrency={askingCurrency}
            onAskingCurrencyChange={setAskingCurrency}
            settlementNote={settlementNote}
            onSettlementNoteChange={setSettlementNote}
            priceInputId="asking-price-update"
            showSettlementFields={false}
            disabled={isPending}
          />
          <Button type="button" disabled={isPending} onClick={() => void runUpdatePrice()}>
            Update asking price
          </Button>
        </section>
      )}

      {active && isSeller && (
        <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">Direct payment instructions</h2>
          <p className="text-xs text-text-secondary">
            Shown to buyers who want to pay you outside Kargain checkout.
          </p>
          <ListingSellerSettlementPanel
            chainId={chainId}
            priceInput=""
            onPriceInputChange={() => {}}
            askingCurrency={askingCurrency}
            onAskingCurrencyChange={() => {}}
            settlementNote={settlementNote}
            onSettlementNoteChange={setSettlementNote}
            priceInputId="settlement-only"
            showAskingFields={false}
            disabled={isPending}
          />
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => void runSaveSettlementNote()}>
            Save payment instructions
          </Button>
        </section>
      )}

      {!active && isOwner && (
        <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">List for sale</h2>
          {!isApproved && (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => void runApprove()}>
              Approve marketplace
            </Button>
          )}
          {isApproved && <p className="text-xs text-accent-warm">Marketplace approved.</p>}
          <ListingSellerSettlementPanel
            chainId={chainId}
            priceInput={priceInput}
            onPriceInputChange={setPriceInput}
            askingCurrency={askingCurrency}
            onAskingCurrencyChange={setAskingCurrency}
            settlementNote={settlementNote}
            onSettlementNoteChange={setSettlementNote}
            priceInputId="asking-price-new"
            disabled={isPending}
          />
          <Button type="button" disabled={isPending || !isApproved} onClick={() => void runList()}>
            List for sale
          </Button>
        </section>
      )}

      {log && (
        <p className="text-sm text-text-secondary" role="status">
          {log}
        </p>
      )}
    </div>
  );
}
