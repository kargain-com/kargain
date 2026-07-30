"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { parseUnits, stringToHex } from "viem";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { ListingSellerSettlementPanel } from "@/components/marketplace/listing-seller-settlement-panel";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { SellerMessagingBanner } from "@/components/marketplace/seller-messaging-banner";
import { Button } from "@/components/ui/button";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useListingChainReads } from "@/hooks/use-listing-chain-reads";
import { ZERO_ADDRESS } from "@/lib/commerce/consignment";
import { DENOMINATION_KIND } from "@/lib/commerce/denomination";
import { hasCommerceMode } from "@/lib/commerce/mode";
import {
  encodeCurrencyCode,
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { formatFiat1e8, fiatCurrencyLabel } from "@/lib/marketplace/fiat-format";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  AUCTION_REQUIRES_VERIFICATION_HINT,
  DELIST_BEFORE_AUCTION_HINT,
} from "@/lib/auction/sale-form-copy";
import {
  FixedPriceConsignmentAbi,
  KarPassportAbi,
} from "@/lib/contracts/abis.generated";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  ascendingConsignmentAddress,
  karPassportAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId, shortChainName } from "@/lib/web3/supported-chains";

type Props = {
  tokenId: string;
  chainId: number;
  passportStatus?: PassportStatus;
};

export function ListingEditClient({
  tokenId,
  chainId,
  passportStatus,
}: Props) {
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, awaitReceipt, runFlow, busy, error, syncLagged } =
    useTxSync(chainId);
  const currencyOptions = listingCurrencyCodesForChain(chainId);
  const [priceInput, setPriceInput] = useState("");
  const [askingCurrency, setAskingCurrency] = useState<ListingCurrencyCode>(
    currencyOptions[0] ?? "USD",
  );
  const [settlementNote, setSettlementNote] = useState("");
  const [log, setLog] = useState<string | null>(null);

  const passport = karPassportAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const { data: reads, refetch: refetchReads } = useReadContracts({
    contracts: passport
      ? [
          {
            address: passport,
            abi: KarPassportAbi,
            functionName: "ownerOf",
            args: [tid],
            chainId: wc,
          },
          {
            address: passport,
            abi: KarPassportAbi,
            functionName: "getApproved",
            args: [tid],
            chainId: wc,
          },
        ]
      : [],
  });

  const commerce = useListingChainReads({ chainId, tokenId });
  const market = commerce.market;

  const ownerOf = reads?.[0]?.result as `0x${string}` | undefined;
  const approved = reads?.[1]?.result as `0x${string}` | undefined;

  const refetchListing = useCallback(async () => {
    await Promise.all([refetchReads(), commerce.refetch()]);
  }, [refetchReads, commerce]);

  const row = commerce.listing;
  const active = row?.active ?? false;
  const seller = row?.seller;
  const fiatPrice1e8 = row?.fiatPrice1e8 ?? 0n;
  const listedFiat = row?.fiatCurrency ?? 0;

  const onChainNote = commerce.settlementNote;

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
  const actionsPending = isPending || busy;
  const auctionHint =
    passportStatus !== undefined && passportStatus !== "VERIFIED"
      ? AUCTION_REQUIRES_VERIFICATION_HINT
      : DELIST_BEFORE_AUCTION_HINT;

  const saveSettlementNote = useCallback(
    async (note: string): Promise<boolean> => {
      if (!market || !note.trim()) return false;
      return (
        (await runTx(() =>
          writeContractAsync({
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "setSettlementNote",
            args: [tid, stringToHex(note.trim())],
            chainId: wc,
          }),
        )) !== false
      );
    },
    [market, runTx, tid, wc, writeContractAsync],
  );

  const runDelist = useCallback(async () => {
    if (!canDelist || !market) return;
    setLog("Delisting…");
    const succeeded = await runTx(() =>
      writeContractAsync({
        address: market,
        abi: FixedPriceConsignmentAbi,
        functionName: "ownerWithdraw",
        args: [tid],
        chainId: wc,
      }),
    );
    if (succeeded) setLog("Delisted.");
  }, [
    canDelist,
    market,
    tid,
    wc,
    runTx,
    writeContractAsync,
  ]);

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
      await awaitReceipt(hash);
      await refetchListing();
      setLog("Marketplace approved.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [address, wrongChain, passport, market, tid, wc, refetchListing, switchChainAsync, writeContractAsync, awaitReceipt]);

  const runList = useCallback(async () => {
    await runFlow(async () => {
      if (!canList || !market) return;
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      const amount = parseUnits(priceInput || "0", 8);
      if (amount <= 0n) {
        setLog("Enter a valid asking price.");
        return;
      }
      setLog("Listing…");
      const openArgs = [
        tid,
        {
          kind: DENOMINATION_KIND.Fiat,
          currencyCode: encodeCurrencyCode(askingCurrency),
        },
        // Native settlement; the asking price is denominated in fiat.
        ZERO_ADDRESS,
        amount,
      ] as const;
      try {
        if (settlementNote.trim()) {
          const hash = await writeContractAsync({
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "openDirect",
            args: openArgs,
          });
          await awaitReceipt(hash);
          setLog("Saving payment instructions…");
          if (!(await saveSettlementNote(settlementNote))) return;
        } else {
          const succeeded = await runTx(() =>
            writeContractAsync({
              address: market,
              abi: FixedPriceConsignmentAbi,
              functionName: "openDirect",
              args: openArgs,
            }),
          );
          if (!succeeded) return;
        }
        await refetchListing();
        setLog("Listed.");
      } catch (err) {
        setLog(txErrorMessage(err));
      }
    });
  }, [
    canList,
    wrongChain,
    market,
    priceInput,
    askingCurrency,
    settlementNote,
    tid,
    wc,
    refetchListing,
    saveSettlementNote,
    switchChainAsync,
    writeContractAsync,
    awaitReceipt,
    runTx,
    runFlow,
  ]);

  const runUpdatePrice = useCallback(async () => {
    await runFlow(async () => {
      if (!canDelist || !market) return;
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      const amount = parseUnits(priceInput || "0", 8);
      if (amount <= 0n) {
        setLog("Enter a valid asking price.");
        return;
      }
      setLog("Updating price…");
      try {
        const succeeded = await runTx(() =>
          writeContractAsync({
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "setPrice",
            args: [tid, amount],
          }),
        );
        if (!succeeded) return;
        if (settlementNote.trim()) {
          setLog("Saving payment instructions…");
          if (!(await saveSettlementNote(settlementNote))) return;
        }
        await refetchListing();
        setLog("Price updated.");
      } catch (err) {
        setLog(txErrorMessage(err));
      }
    });
  }, [
    canDelist,
    wrongChain,
    market,
    priceInput,
    settlementNote,
    tid,
    wc,
    refetchListing,
    saveSettlementNote,
    switchChainAsync,
    writeContractAsync,
    runTx,
    runFlow,
  ]);

  const runSaveSettlementNote = useCallback(async () => {
    if (!active || !isSeller || !market) return;
    if (!settlementNote.trim()) {
      setLog("Enter direct payment instructions.");
      return;
    }
    setLog("Saving payment instructions…");
    if (await saveSettlementNote(settlementNote)) {
      setLog("Payment instructions saved.");
    }
  }, [
    active,
    isSeller,
    market,
    settlementNote,
    saveSettlementNote,
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
        <p className="text-sm text-text-secondary">
          Switch to {shortChainName(chainId)}
        </p>
        <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
          Switch to {shortChainName(chainId)}
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
            <p className="font-mono text-lg font-medium tabular-nums text-text-primary">
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
          {ascendingConsignmentAddress(chainId) ? (
            <p className="font-sans text-sm text-text-secondary" role="status">
              {auctionHint}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="border-status-error text-status-error hover:bg-bg-surface"
            disabled={actionsPending}
            onClick={() => void runDelist()}
          >
            {actionsPending ? "Confirming…" : "Delist"}
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
            disabled={actionsPending}
          />
          <Button type="button" disabled={actionsPending} onClick={() => void runUpdatePrice()}>
            {actionsPending ? "Confirming…" : "Update asking price"}
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
            disabled={actionsPending}
          />
          <Button type="button" variant="secondary" disabled={actionsPending} onClick={() => void runSaveSettlementNote()}>
            {actionsPending ? "Confirming…" : "Save payment instructions"}
          </Button>
        </section>
      )}

      {!active && isOwner && (
        <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">List for sale</h2>
          {commerce.paused === true ? (
            <CommercePausedNotice mode="fixedPrice" />
          ) : null}
          {!isApproved && (
            <Button type="button" variant="outline" disabled={actionsPending || commerce.paused === true} onClick={() => void runApprove()}>
              {actionsPending ? "Confirming…" : "Approve marketplace"}
            </Button>
          )}
          {isApproved && <p className="text-xs text-text-secondary">Marketplace approved.</p>}
          <ListingSellerSettlementPanel
            chainId={chainId}
            priceInput={priceInput}
            onPriceInputChange={setPriceInput}
            askingCurrency={askingCurrency}
            onAskingCurrencyChange={setAskingCurrency}
            settlementNote={settlementNote}
            onSettlementNoteChange={setSettlementNote}
            priceInputId="asking-price-new"
            disabled={actionsPending || commerce.paused === true}
          />
          <Button type="button" disabled={actionsPending || !isApproved || commerce.paused === true} onClick={() => void runList()}>
            {actionsPending ? "Confirming…" : "List for sale"}
          </Button>
        </section>
      )}

      {(error ?? log) && (
        <p className="text-sm text-text-secondary" role="status">
          {error ?? log}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
    </div>
  );
}
