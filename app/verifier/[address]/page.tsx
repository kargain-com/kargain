import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getAddress, isAddress } from "viem";

export function generateMetadata(): Metadata {
  return {
    title: "Redirecting…",
    robots: { index: false, follow: true },
  };
}

export default async function VerifierRedirectPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const decoded = decodeURIComponent(raw);
  if (!isAddress(decoded)) notFound();
  permanentRedirect(`/profile/${getAddress(decoded)}`);
}
