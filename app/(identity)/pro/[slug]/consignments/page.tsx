import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { getProShowroomData } from "@/app/actions/pro-showroom";
import { ProActiveConsignmentsClient } from "@/components/pro/pro-active-consignments-client";
import {
  categoryLabel,
  instrumentReadoutPanel,
  monoLinkSm,
  sansLinkUnderline,
} from "@/lib/design/instrument-classes";
import { proConsignmentsHref, proShowroomHref } from "@/lib/kar-pro/pro-showroom-href";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";
import { isCommercialChainId } from "@/lib/web3/commercial-active";
import { shortChainName } from "@/lib/web3/supported-chains";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

const CONTAINER =
  "mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8";

const loadProShowroom = cache(getProShowroomData);

function resolveShowroomChainParam(
  raw: string | string[] | undefined,
): number | null {
  const parsed = parseOptionalChainParam(raw);
  if (parsed == null || !isCommercialChainId(parsed)) return null;
  return parsed;
}

function displayName(
  name: string | undefined,
  address: `0x${string}`,
): string {
  const trimmed = name?.trim() ?? "";
  return trimmed || navShortAddress(address);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const chainId = resolveShowroomChainParam(sp.chain);
  const result = await loadProShowroom(slug, chainId);
  if (result.kind !== "resolved") return { title: "Active consignments" };

  const name = displayName(result.data.verifier?.name, result.data.address);
  return {
    title: `Active consignments · ${name} · Kargain`,
    description: `Active consignment listings sold by ${name} on Kargain.`,
  };
}

export default async function ProConsignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const chainId = resolveShowroomChainParam(sp.chain);
  const result = await loadProShowroom(slug, chainId);
  if (result.kind === "missing") notFound();

  if (result.kind === "resolved" && chainId == null) {
    redirect(proConsignmentsHref(slug, result.data.chainId));
  }

  if (result.kind === "ambiguous") {
    return (
      <div className="min-h-dvh bg-bg-primary text-text-primary">
        <section className="w-full bg-bg-primary py-16 md:py-24">
          <div className={CONTAINER}>
            <div className={`${instrumentReadoutPanel} max-w-lg space-y-1`}>
              <p className={categoryLabel}>Choose network</p>
              <p className="font-sans text-sm text-text-secondary">
                Pick the showroom membership before viewing consignments.
              </p>
              <ul className="mt-4 divide-y divide-border-default">
                {result.candidates.map((c) => (
                  <li
                    key={`${c.chainId}-${c.address}`}
                    className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <p className="font-mono text-xs text-text-tertiary">
                      {shortChainName(c.chainId)}{" "}
                      <span className="tabular-nums">({c.chainId})</span>
                    </p>
                    <Link
                      href={proConsignmentsHref(slug, c.chainId)}
                      className={monoLinkSm}
                    >
                      View →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const data = result.data;
  const name = displayName(data.verifier?.name, data.address);

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <section className="w-full bg-bg-primary py-16 md:py-24">
        <div className={CONTAINER}>
          <p className="mb-6">
            <Link
              href={proShowroomHref(slug, data.chainId)}
              className={cn(sansLinkUnderline)}
            >
              ← {name}
            </Link>
          </p>
          <header className="mb-12 max-w-3xl md:mb-16">
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              Active consignments
            </h1>
          </header>
          <ProActiveConsignmentsClient address={data.address} />
        </div>
      </section>
    </div>
  );
}
