import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getAuctionDetail } from "@/app/actions/auction-detail";
import { WarningIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { PassportDetailView } from "@/components/passport/passport-detail-view";
import { fetchListingDetail, fetchPassportDetailCached } from "@/lib/passport/fetch-passport-detail";
import { formatKarPassportTitle, parsePassportTokenId } from "@/lib/passport/passport-token-id";
import { resolvePassportLocationRefusal } from "@/lib/passport/action-surface";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";

/** RPC hint for Ponder-miss: URL chain, else origin from v2 tokenId — never invent hub. */
function rpcHintForToken(
  tokenId: string,
  urlChain: string | string[] | undefined | null,
): number | null {
  const fromUrl = parseOptionalChainParam(urlChain);
  if (fromUrl != null) return fromUrl;
  const parsed = parsePassportTokenId(tokenId);
  return parsed.isV2Prefixed ? parsed.chainId : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}): Promise<Metadata> {
  const { tokenId: raw } = await params;
  if (!/^\d+$/.test(raw)) return { title: "Listing" };

  const hint = rpcHintForToken(raw, undefined);
  const result = await fetchPassportDetailCached(raw, hint);
  if (result.ok && result.metadata?.name) {
    return { title: result.metadata.name };
  }
  if (result.ok && result.metadata) {
    const { year, make, model } = result.metadata;
    if (year && make && model) {
      return { title: `${year} ${make} ${model}` };
    }
  }

  const parsed = parsePassportTokenId(raw);
  const chainId = result.ok
    ? result.passport.chainId
    : parsed.isV2Prefixed
      ? parsed.chainId
      : undefined;
  return { title: formatKarPassportTitle(raw, chainId) };
}

function DetailFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-primary text-sm text-text-secondary" role="status">
      Loading passport…
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
  const hintChainId = rpcHintForToken(raw, sp.chain);
  const marketplaceHref = hintChainId != null ? `/?chain=${hintChainId}` : "/";
  try {
    if (!/^\d+$/.test(raw)) notFound();
    BigInt(raw);
  } catch {
    notFound();
  }

  const [result, listing] = await Promise.all([
    fetchPassportDetailCached(raw, hintChainId),
    fetchListingDetail(raw, hintChainId ?? undefined),
  ]);

  if (!result.ok && result.error === "PONDER_UNAVAILABLE") {
    return (
      <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
        <div
          className="mx-auto flex max-w-sm flex-col items-center gap-4 py-16 text-center"
          role="alert"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-default text-text-secondary">
            <WarningIcon size={20} aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-sans text-sm font-medium text-text-primary">
              Marketplace unavailable
            </p>
            <p className="font-sans text-sm text-text-secondary">
              Passport data could not be loaded right now. Try again in a moment.
            </p>
          </div>
          <Link
            href={marketplaceHref}
            className="font-sans text-sm link-underline"
          >
            ← Back to marketplace
          </Link>
        </div>
      </div>
    );
  }

  if (!result.ok && result.error === "NOT_FOUND") {
    return (
      <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
        <div className="mx-auto max-w-lg rounded-md border border-border-hover bg-bg-surface p-6">
          <p className="font-sans text-sm font-medium text-text-primary">Passport not found</p>
          <p className="mt-2 font-sans text-sm text-text-secondary">
            This passport may not exist yet or the indexer has not caught up.
          </p>
          <Link
            href={marketplaceHref}
            className="mt-6 inline-block font-sans text-sm link-underline"
          >
            ← Back to marketplace
          </Link>
        </div>
      </div>
    );
  }

  if (!result.ok) {
    notFound();
  }

  // Location gap — named refusal, never notFound (§4.21).
  if (result.passport.custodyUnresolved || result.passport.custodyChain == null) {
    const refusal = resolvePassportLocationRefusal({
      viewChainId: result.passport.chainId,
      custodyLocked: undefined,
      ponderCustodyChain: result.passport.custodyChain,
      custodyUnresolved: result.passport.custodyUnresolved ?? null,
    });
    if (refusal.status === "refuse") {
      return (
        <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
          <div className="mx-auto max-w-lg">
            <EmptyState
              variant="content"
              level="B"
              title={refusal.title}
              description={refusal.description}
              action={{
                label: "← Back to marketplace",
                href: marketplaceHref,
              }}
            />
          </div>
        </div>
      );
    }
  }

  const commerceChainId = result.passport.custodyChain!;
  const originChainId = result.passport.chainId;
  const auctionResult = await getAuctionDetail(raw);

  // Prefer custody-scoped consignment when the parallel hint fetch missed chain.
  const listingProp =
    listing ??
    (await fetchListingDetail(raw, commerceChainId));

  return (
    <div className="min-h-dvh bg-bg-primary">
      <PassportDetailView
        tokenId={raw}
        chainId={commerceChainId}
        originChainId={originChainId}
        passport={result.passport}
        metadata={result.metadata}
        metadataError={result.metadataError}
        indexerPending={result.indexerPending}
        listing={listingProp}
        auction={auctionResult.ok ? auctionResult.auction : null}
      />
    </div>
  );
}
