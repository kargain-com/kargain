import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress } from "viem";

import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export default async function VerifierPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  let address: `0x${string}`;
  try {
    address = getAddress(decodeURIComponent(raw));
  } catch {
    notFound();
  }

  const detail = await fetchVerifierDetail(address);
  if (!detail) notFound();

  const chainId = DEFAULT_CHAIN_ID;
  const identity = detail.identity as { name?: string; category?: number };
  const verificationCount = Number(detail.verificationCount ?? 0);
  const disputed = (detail.disputedPassports as Array<{ id: string; status: string }>) ?? [];
  const verified = (detail.verifiedPassports as Array<{ id: string }>) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-24 text-text-primary md:px-8">
      <div>
        <h1 className="text-2xl font-medium">{identity.name || "Verifier"}</h1>
        <p className="mt-2 font-mono text-sm text-text-secondary">
          {navShortAddress(address)}
        </p>
        <p className="mt-4 text-sm text-text-secondary">
          {verificationCount} passport(s) verified
        </p>
        <Link
          href={`/profile/${address}`}
          className="mt-4 inline-block text-sm text-accent-warm hover:underline"
        >
          View profile
        </Link>
      </div>

      {disputed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">
            Open disputes
          </h2>
          <ul className="space-y-2">
            {disputed.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/marketplace/${p.id}?chain=${chainId}`}
                  className="flex items-center gap-2 rounded-md border border-border-default px-4 py-3 hover:border-border-hover"
                >
                  <span className="font-mono text-accent-warm">#{p.id}</span>
                  <PassportStatusBadge status="DISPUTED" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {verified.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">
            Recently verified
          </h2>
          <ul className="space-y-2">
            {verified.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/marketplace/${p.id}?chain=${chainId}`}
                  className="block rounded-md border border-border-default px-4 py-3 font-mono text-accent-warm hover:border-border-hover"
                >
                  #{p.id}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
