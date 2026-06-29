import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import { PassportDetailView } from "@/components/passport/passport-detail-view";
import { fetchListingDetail, fetchPassportDetailCached } from "@/lib/passport/fetch-passport-detail";
import { formatKarPassportTitle, parsePassportTokenId } from "@/lib/passport/passport-token-id";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}): Promise<Metadata> {
  const { tokenId: raw } = await params;
  if (!/^\d+$/.test(raw)) return { title: "Listing" };

  const result = await fetchPassportDetailCached(raw, parseChainParam(undefined));
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
  const chainId = parsed.isV2Prefixed ? parsed.chainId : parseChainParam(undefined);
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

function isPonderListingActive(raw: unknown): boolean {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const active = (raw as { active?: unknown }).active;
  return active === true || active === "true";
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

  const [result, listingRaw] = await Promise.all([
    fetchPassportDetailCached(raw, chainId),
    fetchListingDetail(raw),
  ]);

  if (!result.ok && result.error === "PONDER_UNAVAILABLE") {
    return (
      <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
        <div
          className="mx-auto flex max-w-sm flex-col items-center gap-4 py-16 text-center"
          role="alert"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-default text-text-secondary">
            <AlertTriangle size={20} strokeWidth={1.5} aria-hidden />
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
            href={`/?chain=${chainId}`}
            className="font-sans text-sm text-accent-warm link-underline"
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
            href={`/?chain=${chainId}`}
            className="mt-6 inline-block font-sans text-sm text-accent-warm hover:underline"
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

  const listingActive = isPonderListingActive(listingRaw);
  const listing = listingActive
    ? {
        active: true as const,
        fiatPrice1e8: String(
          (listingRaw as { fiatPrice1e8: string | number }).fiatPrice1e8,
        ),
        fiatCurrency: normalizeListingFiatCurrency(
          (listingRaw as { fiatCurrency: number | string }).fiatCurrency,
        ),
        seller: (listingRaw as { seller: string }).seller as `0x${string}`,
      }
    : null;

  return (
    <div className="min-h-dvh bg-bg-primary">
      <PassportDetailView
        tokenId={raw}
        chainId={chainId}
        passport={result.passport}
        metadata={result.metadata}
        metadataError={result.metadataError}
        indexerPending={result.indexerPending}
        listing={listing}
      />
    </div>
  );
}
