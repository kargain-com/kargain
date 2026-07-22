import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CircleCheckIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
  sansLinkUnderline,
} from "@/lib/design/instrument-classes";
import { parseChainParam } from "@/lib/web3/parse-chain-param";
import { getViemChain } from "@/lib/web3/supported-chains";

function PurchasedFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-primary text-sm text-text-secondary" role="status">
      Loading…
    </div>
  );
}

export default function MarketplacePurchasedPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ tx?: string; chain?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<PurchasedFallback />}>
      <MarketplacePurchasedInner params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MarketplacePurchasedInner({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ tx?: string; chain?: string | string[] }>;
}) {
  const { tokenId } = await params;
  const sp = await searchParams;
  const chainId = parseChainParam(sp.chain);
  const { tx } = sp;
  try {
    if (!/^\d+$/.test(tokenId)) notFound();
    BigInt(tokenId);
  } catch {
    notFound();
  }

  const explorer = getViemChain(chainId)?.blockExplorers?.default;
  const scan = tx
    ? `${explorer?.url ?? "https://sepolia.basescan.org"}/tx/${tx}`
    : null;
  const explorerLabel = explorer?.name ?? "Block explorer";

  return (
    <div className="min-h-dvh bg-bg-primary px-4 py-16 text-text-primary">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-medium text-text-primary">You own this passport</h1>
        <div className={`${commerceConfirmedPanel} text-left`} role="status">
          <div className="flex gap-3">
            <div className="shrink-0 text-status-success mt-0.5">
              <CircleCheckIcon size={20} aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <p className={commerceConfirmedLabel}>Purchase complete</p>
              <p className="font-sans text-sm leading-relaxed text-text-secondary">
                The NFT is in your wallet. Passport history will update as the indexer catches up.
              </p>
            </div>
          </div>
        </div>
        {scan && (
          <p>
            <a
              href={scan}
              target="_blank"
              rel="noreferrer"
              className={sansLinkUnderline}
            >
              {explorerLabel}
            </a>
          </p>
        )}
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>View passport</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Back to marketplace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
