import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListingEditClient } from "@/components/marketplace/listing-edit-client";
import { getDetailStrings, pickDetailLocale } from "@/lib/i18n/marketplace-detail-locales";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

function EditFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-primary text-sm text-text-secondary" role="status">
      Loading…
    </div>
  );
}

export default function MarketplaceListingEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<EditFallback />}>
      <MarketplaceListingEditInner params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MarketplaceListingEditInner({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const { tokenId } = await params;
  const sp = await searchParams;
  const chainId = parseChainParam(sp.chain);
  try {
    if (!/^\d+$/.test(tokenId)) notFound();
    BigInt(tokenId);
  } catch {
    notFound();
  }

  const h = await headers();
  const t = getDetailStrings(pickDetailLocale(h.get("accept-language")));

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <ListingEditClient tokenId={tokenId} chainId={chainId} labels={t} />
    </div>
  );
}
