import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PassportCreatedClient } from "@/components/passport/passport-created-client";
import { Button } from "@/components/ui/button";
import { sansLinkUnderline } from "@/lib/design/instrument-classes";
import {
  formatPassportShortLabel,
  parsePassportTokenId,
} from "@/lib/passport/passport-token-id";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";
import { getViemChain } from "@/lib/web3/supported-chains";

function CreatedFallback() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-bg-primary text-sm text-text-secondary"
      role="status"
    >
      Loading…
    </div>
  );
}

export default function MarketplaceCreatedPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ tx?: string; chain?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<CreatedFallback />}>
      <MarketplaceCreatedInner params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function resolvePageChainId(
  tokenId: string,
  urlChain: string | string[] | undefined,
): number | null {
  const fromUrl = parseOptionalChainParam(urlChain);
  if (fromUrl != null) return fromUrl;
  const parsed = parsePassportTokenId(tokenId);
  return parsed.isV2Prefixed ? parsed.chainId : null;
}

async function MarketplaceCreatedInner({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ tx?: string; chain?: string | string[] }>;
}) {
  const { tokenId } = await params;
  const sp = await searchParams;
  const chainId = resolvePageChainId(tokenId, sp.chain);
  const { tx } = sp;

  try {
    if (!/^\d+$/.test(tokenId)) notFound();
    BigInt(tokenId);
  } catch {
    notFound();
  }

  if (chainId == null) notFound();

  const scan = tx
    ? `${getViemChain(chainId)?.blockExplorers?.default?.url ?? "https://sepolia.basescan.org"}/tx/${tx}`
    : null;

  const label = formatPassportShortLabel(tokenId, chainId);

  return (
    <div className="min-h-dvh bg-bg-primary px-4 py-16 text-text-primary">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-medium text-text-primary">Passport created</h1>
        <p className="font-mono text-xs text-text-tertiary">{label}</p>
        <p className="text-sm leading-relaxed text-text-secondary">
          The NFT is in your wallet. Full passport history appears once indexing finishes.
        </p>
        <PassportCreatedClient tokenId={tokenId} chainId={chainId} />
        {scan && (
          <p>
            <a
              href={scan}
              target="_blank"
              rel="noreferrer"
              className={sansLinkUnderline}
            >
              Block explorer
            </a>
          </p>
        )}
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>View passport</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/?chain=${chainId}`}>Back to marketplace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
