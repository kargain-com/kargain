import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getProShowroomData } from "@/app/actions/pro-showroom";
import { ProActiveConsignmentsClient } from "@/components/pro/pro-active-consignments-client";
import { sansLinkUnderline } from "@/lib/design/instrument-classes";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

const CONTAINER =
  "mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8";

const loadProShowroom = cache(getProShowroomData);

function displayName(
  name: string | undefined,
  address: `0x${string}`,
): string {
  const trimmed = name?.trim() ?? "";
  return trimmed || navShortAddress(address);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadProShowroom(slug);
  if (!data) return { title: "Active consignments" };

  const name = displayName(data.verifier?.name, data.address);
  return {
    title: `Active consignments · ${name} · Kargain`,
    description: `Active consignment listings sold by ${name} on Kargain.`,
  };
}

export default async function ProConsignmentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadProShowroom(slug);
  if (!data) notFound();

  const name = displayName(data.verifier?.name, data.address);

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <section className="w-full bg-bg-primary py-16 md:py-24">
        <div className={CONTAINER}>
          <p className="mb-6">
            <Link href={`/pro/${slug}`} className={cn(sansLinkUnderline)}>
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
