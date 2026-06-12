"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { fiatCurrencyLabel, formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import type { getDetailStrings } from "@/lib/i18n/marketplace-detail-locales";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type T = ReturnType<typeof getDetailStrings>;

type Props = {
  tokenId: string;
  chainId: number;
  labels: T;
};

function parseListing(raw: unknown): {
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

export function ListingEditClient({ tokenId, chainId, labels: t }: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [priceInput, setPriceInput] = useState("");
  const [fiatCurrency, setFiatCurrency] = useState<"0" | "1">("0");
  const [log, setLog] = useState<string | null>(null);

  const passport: `0x${string}` | undefined = undefined;
  const market: `0x${string}` | undefined = undefined;
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const listingOnChain = undefined;
  const refetchListing = async () => undefined;
  const ownerOf = undefined;
  const refetchOwner = async () => undefined;
  const approved = undefined;
  // TODO Phase 1.1: removed — pending new contract

  const row = parseListing(listingOnChain);
  const active = row?.active ?? false;
  const seller = row?.seller;
  const fiatPrice1e8 = row?.fiatPrice1e8 ?? 0n;
  const listedFiat = row?.fiat ?? 0;

  const isSeller =
    Boolean(address && seller && address.toLowerCase() === (seller as string).toLowerCase());
  const isOwner =
    Boolean(address && ownerOf && address.toLowerCase() === (ownerOf as string).toLowerCase());

  const canDelist = Boolean(active && isSeller);
  const canList = Boolean(!active && isOwner && address);

  const runDelist = useCallback(async () => {
    // TODO Phase 1.1: removed — pending new contract
    void canDelist;
    void wrongChain;
    void market;
    void tid;
    void config;
    void wc;
    void refetchListing;
    void refetchOwner;
    void switchChainAsync;
    void writeContractAsync;
    setLog("Listing actions are temporarily unavailable.");
  }, [canDelist, wrongChain, market, tid, config, wc, refetchListing, refetchOwner, switchChainAsync, writeContractAsync]);

  const runApprove = useCallback(async () => {
    // TODO Phase 1.1: removed — pending new contract
    void address;
    void wrongChain;
    void passport;
    void market;
    void config;
    void wc;
    void switchChainAsync;
    void writeContractAsync;
    setLog("Listing actions are temporarily unavailable.");
  }, [address, wrongChain, passport, market, config, wc, switchChainAsync, writeContractAsync]);

  const runList = useCallback(async () => {
    // TODO Phase 1.1: removed — pending new contract
    void canList;
    void wrongChain;
    void priceInput;
    void fiatCurrency;
    void approved;
    void market;
    void tid;
    void config;
    void wc;
    void refetchListing;
    void refetchOwner;
    void switchChainAsync;
    void writeContractAsync;
    setLog("Listing actions are temporarily unavailable.");
  }, [
    canList,
    wrongChain,
    priceInput,
    fiatCurrency,
    approved,
    market,
    tid,
    config,
    wc,
    refetchListing,
    refetchOwner,
    switchChainAsync,
    writeContractAsync,
  ]);

  const runUpdatePrice = useCallback(async () => {
    // TODO Phase 1.1: removed — pending new contract
    void canDelist;
    void wrongChain;
    void market;
    void passport;
    void priceInput;
    void fiatCurrency;
    void approved;
    void tid;
    void config;
    void wc;
    void refetchListing;
    void refetchOwner;
    void switchChainAsync;
    void writeContractAsync;
    setLog("Listing actions are temporarily unavailable.");
  }, [
    canDelist,
    wrongChain,
    priceInput,
    fiatCurrency,
    approved,
    market,
    passport,
    tid,
    config,
    wc,
    refetchListing,
    refetchOwner,
    switchChainAsync,
    writeContractAsync,
  ]);

  if (!isConnected) {
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
        <p className="text-sm text-text-secondary">{t.connectToBuy}</p>
        <WalletLoginButton />
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{t.wrongNetwork}</p>
        <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
          {t.wrongNetwork}
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

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium text-text-primary">{t.editListing}</h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>← {t.backMarketplace}</Link>
        </Button>
      </div>

      <section className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-4">
        <p className="text-xs text-text-secondary">Token</p>
        <p className="font-mono text-sm text-text-primary">#{tokenId}</p>
        {active ? (
          <>
            <p className="text-xs text-text-secondary pt-2">{t.price}</p>
            <p className="text-lg font-medium text-accent-warm">
              {formatFiat1e8(fiatPrice1e8)} {fiatCurrencyLabel(listedFiat)}
            </p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">{t.notForSale}</p>
        )}
      </section>

      {active && isSeller && (
        <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">{t.delist}</h2>
          <Button
            type="button"
            variant="outline"
            className="border-status-error text-status-error hover:bg-bg-surface"
            disabled={isPending}
            onClick={() => void runDelist()}
          >
            {t.delist}
          </Button>
        </section>
      )}

      {active && isSeller && (
        <section className="space-y-4 rounded-md border border-accent-warm/40 bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">Update fiat price</h2>
          <p className="text-xs text-text-secondary">
            Contract has no single-step price edit. We delist, then relist (two on-chain steps in one action).
          </p>
          <div className="space-y-2">
            <Label htmlFor="fiat-upd">Amount ({fiatCurrency === "0" ? "USD" : "EUR"}, 8 decimals on-chain)</Label>
            <Input
              id="fiat-upd"
              inputMode="decimal"
              placeholder="25000.50"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={fiatCurrency} onValueChange={(v) => setFiatCurrency(v as "0" | "1")}>
              <SelectTrigger className="border-border-default bg-bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border-default bg-bg-primary">
                <SelectItem value="0">USD</SelectItem>
                <SelectItem value="1">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={isPending} onClick={() => void runUpdatePrice()}>
            {t.relist}
          </Button>
        </section>
      )}

      {!active && isOwner && (
        <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
          <h2 className="text-sm font-medium text-text-primary">{t.relist}</h2>
          {!approved && (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => void runApprove()}>
              {t.approveMarketplace}
            </Button>
          )}
          {approved && <p className="text-xs text-accent-warm">Marketplace approved.</p>}
          <div className="space-y-2">
            <Label htmlFor="fiat-new">List price (USD or EUR units, stored 1e8)</Label>
            <Input
              id="fiat-new"
              inputMode="decimal"
              placeholder="42000"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={fiatCurrency} onValueChange={(v) => setFiatCurrency(v as "0" | "1")}>
              <SelectTrigger className="border-border-default bg-bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border-default bg-bg-primary">
                <SelectItem value="0">USD</SelectItem>
                <SelectItem value="1">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={isPending || !approved} onClick={() => void runList()}>
            {t.relist}
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
