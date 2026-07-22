import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListingEditClient } from "@/components/marketplace/listing-edit-client";
import { fetchPassportDetailCached } from "@/lib/passport/fetch-passport-detail";
import { parsePassportTokenId } from "@/lib/passport/passport-token-id";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";

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
  try {
    if (!/^\d+$/.test(tokenId)) notFound();
    BigInt(tokenId);
  } catch {
    notFound();
  }

  const fromUrl = parseOptionalChainParam(sp.chain);
  const parsed = parsePassportTokenId(tokenId);
  const hint =
    fromUrl ?? (parsed.isV2Prefixed ? parsed.chainId : null);

  const passportResult = await fetchPassportDetailCached(tokenId, hint);
  const chainId = passportResult.ok
    ? passportResult.passport.custodyChain
    : hint;
  if (chainId == null) notFound();

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <ListingEditClient
        tokenId={tokenId}
        chainId={chainId}
        passportStatus={
          passportResult.ok ? passportResult.passport.status : undefined
        }
      />
    </div>
  );
}
