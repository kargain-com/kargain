"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { parseUnits, stringToHex } from "viem";
import { useWriteContract } from "wagmi";

import { ListingDisplayPrice } from "@/components/marketplace/listing-display-price";
import { ListingSellerSettlementPanel } from "@/components/marketplace/listing-seller-settlement-panel";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { SellerMessagingBanner } from "@/components/marketplace/seller-messaging-banner";
import { Button } from "@/components/ui/button";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useOpenableTerms } from "@/hooks/use-openable-terms";
import { useListingChainReads } from "@/hooks/use-listing-chain-reads";
import { usePassportApproval } from "@/hooks/use-passport-approval";
import { ZERO_ADDRESS } from "@/lib/commerce/consignment";
import {
  DENOMINATION_KIND,
  ZERO_CURRENCY_CODE,
  type DenominationKind,
  encodeCurrencyCode,
} from "@/lib/commerce/denomination";
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
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";

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
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
        const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, awaitReceipt, runFlow, busy, error, syncLagged } =
    useTxSync(chainId);
  const { options: openOptions, pending: openOptionsPending } =
    useOpenableTerms(chainId, "fixedPrice");

  const [priceInput, setPriceInput] = useState("");
  const [askingCurrency, setAskingCurrency] = useState("USD");
  const [settlementAsset, setSettlementAsset] = useState<string>(ZERO_ADDRESS);
  const [denominationKind, setDenominationKind] = useState<DenominationKind>(
    DENOMINATION_KIND.Fiat,
  );
  const [settlementNote, setSettlementNote] = useState("");
  const [log, setLog] = useState<string | null>(null);

  const passport = karPassportAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  useEffect(() => {
    if (!openOptions.available || openOptions.assets.length === 0) return;
    const stillValid = openOptions.assets.some(
      (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
    );
    if (!stillValid) {
      setSettlementAsset(openOptions.assets[0]!.token);
    }
  }, [openOptions, settlementAsset]);

  useEffect(() => {
    if (openOptions.fiatCurrencyCodes.length === 0) return;
    if (!openOptions.fiatCurrencyCodes.includes(askingCurrency)) {
      setAskingCurrency(openOptions.fiatCurrencyCodes[0]!);
    }
  }, [openOptions.fiatCurrencyCodes, askingCurrency]);

  useEffect(() => {
    const asset = openOptions.assets.find(
      (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
    );
    if (
      asset &&
      denominationKind === DENOMINATION_KIND.Fiat &&
      !asset.fiatDenomination
    ) {
      setDenominationKind(DENOMINATION_KIND.Asset);
    }
  }, [openOptions.assets, settlementAsset, denominationKind]);

  const ownershipReads = useKeyedReadContracts({
    contracts: passport
      ? [
          {
            key: "ownerOf" as const,
            address: passport,
            abi: KarPassportAbi,
            functionName: "ownerOf",
            args: [tid],
            chainId: wc,
          },
        ]
      : [],
  });

  const commerce = useListingChainReads({ chainId, tokenId });
  const market = commerce.market;

  const {
    isApproved,
    approveToken,
    approvalBusy,
    refetch: refetchApproval,
  } = usePassportApproval({
    chainId,
    tokenId,
    spender: market,
    enabled: Boolean(market && address),
  });

  const ownerOf = ownershipReads.get("ownerOf") as `0x${string}` | undefined;

  const refetchListing = useCallback(async () => {
    await Promise.all([
      ownershipReads.refetch(),
      commerce.refetch(),
      refetchApproval(),
    ]);
  }, [ownershipReads, commerce, refetchApproval]);

  const row = commerce.listing;
  const active = row?.active ?? false;
  const seller = row?.seller;

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

  const actionsPending = isPending || busy || approvalBusy;
  const auctionHint =
    passportStatus !== undefined && passportStatus !== "VERIFIED"
      ? AUCTION_REQUIRES_VERIFICATION_HINT
      : DELIST_BEFORE_AUCTION_HINT;

  const selectedAsset = openOptions.assets.find(
    (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
  );
  const priceDecimals =
    denominationKind === DENOMINATION_KIND.Asset
      ? (selectedAsset?.decimals ?? 18)
      : 8;

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
    if (!address || !market) return;
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setLog("Approving marketplace…");
    try {
      await approveToken(awaitReceipt);
      setLog("Marketplace approved.");
    } catch (err) {
      setLog(txErrorMessage(err));
    }
  }, [
    address,
    wrongChain,
    market,
    wc,
    switchChain,
    approveToken,
    awaitReceipt, switchAvail]);

  const runList = useCallback(async () => {
    await runFlow(async () => {
      if (!canList || !market || isApproved !== true) return;
      if (!openOptions.available) {
        setLog(openOptions.unavailableReason ?? "Cannot list on this chain.");
        return;
      }
      const asset = openOptions.assets.find(
        (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
      );
      if (!asset) {
        setLog("Select a settlement asset.");
        return;
      }
      if (
        denominationKind === DENOMINATION_KIND.Fiat &&
        !asset.fiatDenomination
      ) {
        setLog(asset.fiatUnavailableReason ?? "Fiat is not available for this asset.");
        return;
      }
      if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
      const decimals =
        denominationKind === DENOMINATION_KIND.Asset ? asset.decimals : 8;
      const amount = parseUnits(priceInput || "0", decimals);
      if (amount <= 0n) {
        setLog("Enter a valid asking price.");
        return;
      }
      setLog("Listing…");
      const openArgs = [
        tid,
        {
          kind: denominationKind,
          currencyCode:
            denominationKind === DENOMINATION_KIND.Fiat
              ? encodeCurrencyCode(askingCurrency)
              : ZERO_CURRENCY_CODE,
        },
        settlementAsset as `0x${string}`,
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
    isApproved,
    wrongChain,
    market,
    openOptions,
    settlementAsset,
    denominationKind,
    priceInput,
    askingCurrency,
    settlementNote,
    tid,
    wc,
    refetchListing,
    saveSettlementNote,
    switchChain,
    writeContractAsync,
    awaitReceipt,
    runTx,
    runFlow, switchAvail]);

  const runUpdatePrice = useCallback(async () => {
    await runFlow(async () => {
      if (!canDelist || !market) return;
      if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
      const amount = parseUnits(priceInput || "0", priceDecimals);
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
    priceDecimals,
    settlementNote,
    tid,
    wc,
    refetchListing,
    saveSettlementNote,
    switchChain,
    writeContractAsync,
    runTx,
    runFlow, switchAvail]);

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
        <Button type="button" onClick={() => {
              if (!switchAvail.available) return;
              void switchChain(wc );
            }}>
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

  const panelShared = {
    openOptions,
    openOptionsPending,
    settlementAsset,
    onSettlementAssetChange: setSettlementAsset,
    denominationKind,
    onDenominationKindChange: setDenominationKind,
    chainId,
    askingCurrency,
    onAskingCurrencyChange: setAskingCurrency,
  } as const;

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
        {active && row ? (
          <>
            <p className="text-xs text-text-secondary pt-2">Asking price</p>
            <ListingDisplayPrice
              facts={{
                chainId,
                price: row.price,
                denominationKind: row.denominationKind,
                asset: row.asset,
                currencyCode: row.currencyCode,
                fiatCurrency: row.fiatCurrency,
              }}
              className="font-mono text-lg font-medium tabular-nums text-text-primary"
            />
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
            {...panelShared}
            priceInput={priceInput}
            onPriceInputChange={setPriceInput}
            settlementNote={settlementNote}
            onSettlementNoteChange={setSettlementNote}
            priceInputId="asking-price-update"
            showSettlementFields={false}
            showOpenPairingFields={false}
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
            {...panelShared}
            priceInput=""
            onPriceInputChange={() => {}}
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
          {isApproved !== true && (
            <Button type="button" variant="outline" disabled={actionsPending || commerce.paused === true} onClick={() => void runApprove()}>
              {actionsPending ? "Confirming…" : "Approve fixed-price mode"}
            </Button>
          )}
          {isApproved === true && <p className="text-xs text-text-secondary">Fixed-price mode approved.</p>}
          <p className="font-sans text-xs text-text-secondary">
            On an on-chain buy, payment splits immediately between you, any
            agent, and the platform — there is no protection window. Undeliverable
            payouts appear under Claims for withdrawClaim.
          </p>
          <ListingSellerSettlementPanel
            {...panelShared}
            priceInput={priceInput}
            onPriceInputChange={setPriceInput}
            settlementNote={settlementNote}
            onSettlementNoteChange={setSettlementNote}
            priceInputId="asking-price-new"
            disabled={actionsPending || commerce.paused === true}
          />
          <Button type="button" disabled={actionsPending || isApproved !== true || commerce.paused === true || !openOptions.available} onClick={() => void runList()}>
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
