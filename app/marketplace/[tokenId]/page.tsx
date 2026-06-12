import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getDetailStrings, pickDetailLocale } from "@/lib/i18n/marketplace-detail-locales";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}): Promise<Metadata> {
  const { tokenId: raw } = await params;
  if (!/^\d+$/.test(raw)) return { title: "Listing" };
  return { title: `KarPassport #${raw}` };
}

function DetailFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-primary text-sm text-text-secondary" role="status">
      Loading listing…
    </div>
  );
}

export default function MarketplaceListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<DetailFallback />}>
      <MarketplaceListingInner params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MarketplaceListingInner({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const { tokenId: raw } = await params;
  const sp = await searchParams;
  const chainId = parseChainParam(sp.chain);
  try {
    if (!/^\d+$/.test(raw)) notFound();
    BigInt(raw);
  } catch {
    notFound();
  }

  const h = await headers();
  const t = getDetailStrings(pickDetailLocale(h.get("accept-language")));

  // TODO Phase 1.1: Listing detail pending new contracts and Ponder indexer
  return (
    <div className="min-h-dvh bg-bg-primary px-4 py-12 text-text-primary">
      <div className="mx-auto max-w-lg rounded-md border border-border-hover bg-bg-surface p-6">
        <p className="text-sm font-medium text-text-primary">Listing detail unavailable</p>
        <p className="mt-2 text-sm text-text-secondary">
          Marketplace listings will return after new contracts and the Ponder indexer are deployed.
        </p>
        <Link href={`/?chain=${chainId}`} className="mt-6 inline-block text-sm text-accent-warm hover:underline">
          ← {t.backMarketplace}
        </Link>
      </div>
    </div>
  );
}
