"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useReadContracts,
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
import {
  KarPassportAbi,
  MarketplaceEscrowAbi,
} from "@/lib/contracts/abis.generated";
import { fiatCurrencyLabel, formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import {
  karPassportAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  tokenId: string;
  chainId: number;
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

export function ListingEditClient({ tokenId, chainId }: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [priceInput, setPriceInput] = useState("");
  const [fiatCurrency, setFiatCurrency] = useState<"0" | "1">("0");
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
          ]
        : [],
  });

  const ownerOf = reads?.[0]?.result as `0x${string}` | undefined;
  const approved = reads?.[1]?.result as `0x${string}` | undefined;
  const listingOnChain = reads?.[2]?.result;
  const refetchListing = refetchReads;
  const refetchOwner = refetchReads;

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

  const isApproved =
    Boolean(market && approved && approved.toLowerCase() === market.toLowerCase());

  const runDelist = useCallback(async () => {
    if (!canDelist || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setLog("Delisting…");
    const hash = await writeContractAsync({
      address: market,
      abi: MarketplaceEscrowAbi,
      functionName: "delist",
      args: [tid],
    });
    await waitForTransactionReceipt(config, { hash });
    await refetchListing();
    setLog("Delisted.");
  }, [canDelist, wrongChain, market, tid, config, wc, refetchListing, switchChainAsync, writeContractAsync]);

  const runApprove = useCallback(async () => {
    if (!address || !passport || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setLog("Approving marketplace…");
    const hash = await writeContractAsync({
      address: passport,
      abi: KarPassportAbi,
      functionName: "approve",
      args: [market, tid],
    });
    await waitForTransactionReceipt(config, { hash });
    await refetchOwner();
    setLog("Marketplace approved.");
  }, [address, wrongChain, passport, market, tid, config, wc, refetchOwner, switchChainAsync, writeContractAsync]);

  const runList = useCallback(async () => {
    if (!canList || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    const amount = parseUnits(priceInput || "0", 8);
    if (amount <= 0n) {
      setLog("Enter a valid price.");
      return;
    }
    setLog("Listing…");
    const hash = await writeContractAsync({
      address: market,
      abi: MarketplaceEscrowAbi,
      functionName: "list",
      args: [tid, amount, Number(fiatCurrency)],
    });
    await waitForTransactionReceipt(config, { hash });
    await refetchListing();
    setLog("Listed.");
  }, [canList, wrongChain, market, priceInput, fiatCurrency, tid, config, wc, refetchListing, switchChainAsync, writeContractAsync]);

  const runUpdatePrice = useCallback(async () => {
    if (!canDelist || !market || !passport) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    const amount = parseUnits(priceInput || "0", 8);
    if (amount <= 0n) {
      setLog("Enter a valid price.");
      return;
    }
    setLog("Updating price (delist + relist)…");
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
      args: [tid, amount, Number(fiatCurrency)],
    });
    await waitForTransactionReceipt(config, { hash });
    await refetchListing();
    setLog("Price updated.");
  }, [
    canDelist,
    wrongChain,
    market,
    passport,
    priceInput,
    fiatCurrency,
    isApproved,
    tid,
    config,
    wc,
    refetchListing,
    switchChainAsync,
    writeContractAsync,
  ]);

  if (!isConnected) {
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
        <p className="text-sm text-text-secondary">Connect wallet to buy</p>
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

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium text-text-primary">Manage listing</h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>← Back to marketplace</Link>
        </Button>
      </div>

      <section className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-4">
        <p className="text-xs text-text-secondary">Token</p>
        <p className="font-mono text-sm text-text-primary">#{tokenId}</p>
        {active ? (
          <>
            <p className="text-xs text-text-secondary pt-2">Price</p>
            <p className="text-lg font-medium text-accent-warm">
              {formatFiat1e8(fiatPrice1e8)} {fiatCurrencyLabel(listedFiat)}
            </p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Not currently listed</p>
        )}
      </section>

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
            Update price
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
