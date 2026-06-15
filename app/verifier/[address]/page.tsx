import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { getAddress } from "viem";

import { getPassportsByVerifier } from "@/app/actions/marketplace-listings";
import { getVerifierAttestations } from "@/app/actions/verifier-attestations";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import { fetchVerifierDetail } from "@/lib/passport/fetch-passport-detail";
import type { PonderVerifierAttestation } from "@/lib/types/ponder";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

function formatChainDate(timestampSec: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

function evidenceHref(evidenceCID: string): string | null {
  const trimmed = evidenceCID.trim();
  if (!trimmed) return null;
  return (
    arUriToHttp(trimmed) ??
    (trimmed.startsWith("http") ? trimmed : `https://arweave.net/${trimmed}`)
  );
}

function parseVerifierAddress(raw: string): `0x${string}` | null {
  try {
    return getAddress(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

function AttestationRow({
  attestation,
  chainId,
}: {
  attestation: PonderVerifierAttestation;
  chainId: number;
}) {
  const href = evidenceHref(attestation.evidenceCID);
  const date = formatChainDate(attestation.timestamp);

  return (
    <div className="flex flex-col gap-1">
      <Link
        href={`/marketplace/${attestation.tokenId}?chain=${chainId}`}
        className="font-mono text-sm text-accent-warm hover:underline"
      >
        Passport #{attestation.tokenId}
      </Link>
      {attestation.description.trim() && (
        <p className="line-clamp-2 font-sans text-sm text-text-primary">
          {attestation.description.trim()}
        </p>
      )}
      {date && <p className="font-mono text-xs text-text-secondary">{date}</p>}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-sans text-xs text-accent-warm hover:underline"
        >
          Evidence ↗
        </a>
      )}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address: raw } = await params;
  const address = parseVerifierAddress(raw);
  if (!address) return { title: "Verifier" };

  const detail = await fetchVerifierDetail(address);
  if (!detail) {
    return {
      title: `${navShortAddress(address)} · Not a KarPro verifier · Kargain`,
    };
  }

  const identity = detail.identity as { name?: string };
  const name = identity.name?.trim() || navShortAddress(address);
  return {
    title: `${name} · KarPro verifier · Kargain`,
  };
}

export default async function VerifierPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = parseVerifierAddress(raw);
  if (!address) notFound();

  const detail = await fetchVerifierDetail(address);
  const attestationsResult = await getVerifierAttestations(address);
  const chainId = DEFAULT_CHAIN_ID;

  if (!detail) {
    const verifiedPassports = await getPassportsByVerifier(address);

    return (
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-24 text-text-primary md:px-8">
        <div className="py-8 text-center">
          <ShieldOff
            size={48}
            strokeWidth={1}
            className="mx-auto text-text-tertiary"
            aria-hidden
          />
          <p className="mt-4 font-mono text-sm text-text-secondary">
            {navShortAddress(address)}
          </p>
          <h1 className="mt-4 font-display text-fluid-h2 font-medium">
            Not a KarPro verifier
          </h1>
          <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-text-secondary">
            This address has not activated KarPro verification. Passports verified
            by this address will still appear below if they exist.
          </p>
          <Link
            href="/verifiers"
            className="mt-4 inline-block font-sans text-sm text-accent-warm hover:underline"
          >
            View verifier directory →
          </Link>
        </div>

        {verifiedPassports.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">
              Recently verified
            </h2>
            <ul className="space-y-2">
              {verifiedPassports.map((p) => (
                <li key={p.tokenId}>
                  <Link
                    href={`/marketplace/${p.tokenId}?chain=${chainId}`}
                    className="block rounded-md border border-border-default px-4 py-3 font-mono text-accent-warm hover:border-border-hover"
                  >
                    #{p.tokenId}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="font-sans text-sm text-text-secondary">
            No verified passports.
          </p>
        )}

        <section id="attestations">
          <h2 className="mb-4 font-sans text-base font-medium text-text-primary">
            Attestations
          </h2>
          {attestationsResult.attestations.length === 0 ? (
            <p className="font-sans text-sm text-text-secondary">No attestations yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {attestationsResult.attestations.map((attestation) => (
                <AttestationRow
                  key={`${attestation.tokenId}-${attestation.timestamp}`}
                  attestation={attestation}
                  chainId={chainId}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  const identity = detail.identity as { name?: string; category?: number };
  const stake = detail.stake as { active?: boolean; amount?: string };
  const verificationCount = Number(detail.verificationCount ?? 0);
  const disputed = (detail.disputedPassports as Array<{ id: string; status: string }>) ?? [];
  const verified = (detail.verifiedPassports as Array<{ id: string }>) ?? [];
  const isActive = stake.active === true;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-24 text-text-primary md:px-8">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium">{identity.name || "Verifier"}</h1>
          {isActive ? (
            <span className="rounded border border-accent-warm/40 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-warm">
              Active verifier
            </span>
          ) : (
            <span className="rounded border border-status-error/40 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-status-error">
              Verifier inactive
            </span>
          )}
        </div>
        <p className="mt-2 font-mono text-sm text-text-secondary">
          {navShortAddress(address)}
        </p>
        <p className="mt-4 text-sm text-text-secondary">
          {verificationCount} passport(s) verified
        </p>
        {!isActive && (
          <p className="mt-3 rounded-md border border-status-error/30 p-3 text-sm text-text-secondary">
            This verifier is no longer staking. Passports they verified may still show as verified
            on-chain until disputed or reset.
          </p>
        )}
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

      <section id="attestations">
        <h2 className="mb-4 font-sans text-base font-medium text-text-primary">Attestations</h2>
        {attestationsResult.attestations.length === 0 ? (
          <p className="font-sans text-sm text-text-secondary">No attestations yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {attestationsResult.attestations.map((attestation) => (
              <AttestationRow
                key={`${attestation.tokenId}-${attestation.timestamp}`}
                attestation={attestation}
                chainId={chainId}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
