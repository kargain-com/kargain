import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { getDetailStrings, pickDetailLocale } from "@/lib/i18n/marketplace-detail-locales";
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

  const h = await headers();
  const t = getDetailStrings(pickDetailLocale(h.get("accept-language")));
  const scan = tx
    ? `${getViemChain(DEFAULT_CHAIN_ID)?.blockExplorers?.default?.url ?? "https://sepolia.basescan.org"}/tx/${tx}`
    : null;

  return (
    <div className="min-h-dvh bg-bg-primary px-4 py-16 text-text-primary">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-medium text-accent-warm">{t.purchasedTitle}</h1>
        <p className="text-sm leading-relaxed text-text-secondary">{t.purchasedSubtitle}</p>
        {scan && (
          <p>
            <a
              href={scan}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-accent-warm underline-offset-2 hover:underline"
            >
              BaseScan
            </a>
          </p>
        )}
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href={`/marketplace/${tokenId}`}>{t.viewPassport}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">{t.backMarketplace}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
