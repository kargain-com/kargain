import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
  sansLinkUnderline,
} from "@/lib/design/instrument-classes";
import { DEFAULT_CHAIN_ID, getViemChain } from "@/lib/web3/supported-chains";

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
  searchParams: Promise<{ tx?: string }>;
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
  searchParams: Promise<{ tx?: string }>;
}) {
  const { tokenId } = await params;
  const { tx } = await searchParams;
  try {
    if (!/^\d+$/.test(tokenId)) notFound();
    BigInt(tokenId);
  } catch {
    notFound();
  }

  const scan = tx
    ? `${getViemChain(DEFAULT_CHAIN_ID)?.blockExplorers?.default?.url ?? "https://sepolia.basescan.org"}/tx/${tx}`
    : null;

  return (
    <div className="min-h-dvh bg-bg-primary px-4 py-16 text-text-primary">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-medium text-text-primary">You own this passport</h1>
        <div className={`${commerceConfirmedPanel} text-left`} role="status">
          <div className="flex gap-3">
            <div className="shrink-0 text-status-success mt-0.5">
              <CheckCircle size={20} strokeWidth={1.5} aria-hidden />
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
              BaseScan
            </a>
          </p>
        )}
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href={`/marketplace/${tokenId}`}>View passport</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Back to marketplace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
