import { notFound } from "next/navigation";
import { getAddress } from "viem";

import { fetchKarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import {
  getPassportsByVerifier,
  getProfileData,
} from "@/app/actions/marketplace-listings";
import { ProfileContentTabs } from "@/components/profile/profile-content-tabs";
import { ProfileHeaderIdentity } from "@/components/profile/profile-header-identity";
import { FadeUp } from "@/components/ui/fade-up";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import type { PassportStatus } from "@/lib/types/ponder";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: raw } = await params;
  const handle = decodeURIComponent(raw);
  if (!handle) notFound();
  let wallet: `0x${string}`;
  try {
    wallet = getAddress(handle);
  } catch {
    notFound();
  }

  const chainId = DEFAULT_CHAIN_ID;

  const staking = karProStakingAddress(chainId);
  let isActiveVerifier = false;
  if (staking) {
    try {
      isActiveVerifier = await getPublicClient(chainId).readContract({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "isActiveVerifier",
        args: [wallet],
      });
    } catch {
      /* remain false */
    }
  }

  const verifierProfile = isActiveVerifier
    ? await fetchKarProVerifierProfile(wallet)
    : null;
  const verificationCount = verifierProfile?.verificationCount ?? 0;
  const proShowroomSlug = verifierProfile?.slug?.trim() || null;

  let ponderErr: string | null = null;
  let passports: { tokenId: string; status: PassportStatus; vin?: string | null }[] = [];
  let listings: {
    tokenId: string;
    active: boolean;
    passportStatus: PassportStatus;
    make?: string;
    model?: string;
  }[] = [];
  let verifiedPassports: Awaited<ReturnType<typeof getPassportsByVerifier>> = [];

  try {
    const [data, verified] = await Promise.all([
      getProfileData(wallet),
      isActiveVerifier ? getPassportsByVerifier(wallet) : Promise.resolve([]),
    ]);
    verifiedPassports = verified;
    passports = (data.passports as Array<Record<string, unknown>>).map((p) => ({
      tokenId: String(p.id ?? ""),
      status: (p.status as PassportStatus) ?? "UNVERIFIED",
      vin: typeof p.vin === "string" && p.vin ? p.vin : null,
    }));
    listings = (data.listings as Array<Record<string, unknown>>)
      .filter((l) => l.active === true)
      .map((l) => ({
        tokenId: String(l.tokenId ?? l.id ?? ""),
        active: true,
        passportStatus: (l.passportStatus as PassportStatus) ?? "UNVERIFIED",
        make: typeof l.make === "string" ? l.make : undefined,
        model: typeof l.model === "string" ? l.model : undefined,
      }));
  } catch {
    ponderErr = "PONDER_UNAVAILABLE";
  }

  const profile: {
    avatarCid?: string | null;
    displayName?: string | null;
    username?: string | null;
    locationLabel?: string | null;
    bio?: string | null;
    socialLinks?: { twitter?: string; website?: string; discord?: string };
  } | null = {};

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-24 md:px-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <ProfileHeaderIdentity
          wallet={wallet}
          profileDisplayName={profile?.displayName}
          profileUsername={profile?.username}
          locationLabel={profile?.locationLabel}
          bio={profile?.bio}
          socialLinks={profile?.socialLinks}
          isActiveVerifier={isActiveVerifier}
          verifierName={verifierProfile?.name}
          verifierCategory={verifierProfile?.category}
          proShowroomSlug={proShowroomSlug}
        />
      </div>

      {ponderErr && (
        <div className="rounded-sm border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          <p className="font-medium text-text-primary">Indexer unavailable</p>
          <p className="mt-1">Start the Ponder indexer to load profile listings.</p>
          <code className="mt-2 inline-block rounded-sm bg-bg-card px-2 py-1 font-mono text-xs">
            pnpm ponder:dev
          </code>
        </div>
      )}

      <FadeUp>
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">
            Account
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-md border border-border-default bg-bg-surface p-4">
              <h3 className="text-sm font-medium text-text-primary">Listings</h3>
              <p className="mt-1 text-xs text-text-secondary">
                Vehicles and listing lifecycle linked to this wallet.
              </p>
              <p className="mt-3 text-lg font-medium text-accent-warm">{listings.length}</p>
            </article>
            <article className="rounded-md border border-border-default bg-bg-surface p-4">
              <h3 className="text-sm font-medium text-text-primary">Passports</h3>
              <p className="mt-1 text-xs text-text-secondary">
                KarPassport NFTs owned by this wallet.
              </p>
              <p className="mt-3 text-lg font-medium text-accent-warm">{passports.length}</p>
            </article>
            {isActiveVerifier && verificationCount > 0 && (
              <article className="rounded-md border border-border-default bg-bg-surface p-4">
                <h3 className="text-sm font-medium text-text-primary">Verifications</h3>
                <p className="mt-1 text-xs text-text-secondary">
                  Passports verified by this KarPro.
                </p>
                <p className="mt-3 text-lg font-medium text-accent-warm">{verificationCount}</p>
              </article>
            )}
            <article className="rounded-md border border-border-default bg-bg-surface p-4">
              <h3 className="text-sm font-medium text-text-primary">Saved</h3>
              <p className="mt-1 text-xs text-text-secondary">
                Garage favorites published to Nostr relays.
              </p>
              <p className="mt-3 text-sm text-text-secondary">
                Visible in Saved tab when this wallet has saved listings.
              </p>
            </article>
            <article className="rounded-md border border-border-default bg-bg-surface p-4">
              <h3 className="text-sm font-medium text-text-primary">Identity</h3>
              <p className="mt-1 text-xs text-text-secondary">
                Wallet-based profile identity and Kar Pro status.
              </p>
              <p className="mt-3 text-sm text-text-secondary">
                {isActiveVerifier
                  ? "KarPro verifier active on this wallet."
                  : "Kar Pro not active."}
              </p>
            </article>
          </div>
        </section>
      </FadeUp>

      <FadeUp delay={0.1}>
        <ProfileContentTabs
          wallet={wallet}
          chainId={chainId}
          passports={passports}
          listings={listings}
          verifiedPassports={verifiedPassports}
          isActiveVerifier={isActiveVerifier}
          verificationCount={verificationCount}
          ponderErr={ponderErr}
        />
      </FadeUp>
      </div>
    </div>
  );
}
