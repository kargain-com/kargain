import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress } from "viem";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { ProfileFavoritesSection } from "@/components/profile/profile-favorites-section";
import { FadeUp } from "@/components/ui/fade-up";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { WalletAddress } from "@/components/ui/wallet-address";
import type { PassportStatus } from "@/lib/types/ponder";
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

  let ponderErr: string | null = null;
  let passports: { tokenId: string; status: PassportStatus; vin?: string | null }[] = [];
  let listings: { tokenId: string; status: string }[] = [];

  try {
    const data = await getProfileData(wallet);
    passports = (data.passports as Array<Record<string, unknown>>).map((p) => ({
      tokenId: String(p.id ?? ""),
      status: (p.status as PassportStatus) ?? "UNVERIFIED",
      vin: typeof p.vin === "string" && p.vin ? p.vin : null,
    }));
    listings = (data.listings as Array<Record<string, unknown>>)
      .filter((l) => l.active === true)
      .map((l) => ({
        tokenId: String(l.tokenId ?? l.id ?? ""),
        status: "active",
      }));
  } catch {
    ponderErr = "PONDER_UNAVAILABLE";
  }

  const karProBal = 0n;

  const profile: {
    avatarCid?: string | null;
    displayName?: string | null;
    username?: string | null;
    locationLabel?: string | null;
    bio?: string | null;
    socialLinks?: { twitter?: string; website?: string; discord?: string };
  } | null = {};
  const avatarUrl = null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-24 text-text-primary md:px-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md border border-border-default bg-bg-surface">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-text-secondary">No avatar</div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-medium tracking-tight">
              {profile?.displayName || profile?.username || wallet}
            </h1>
            {karProBal > 0n && <KarProBadge />}
          </div>
          <WalletAddress address={wallet} showCopy />
          {profile?.locationLabel && <p className="text-sm text-text-secondary">{profile.locationLabel}</p>}
          {profile?.bio && <p className="text-sm leading-relaxed text-text-primary">{profile.bio}</p>}
          <div className="flex flex-wrap gap-3 text-sm text-accent-warm">
            {profile?.socialLinks?.twitter && (
              <a href={profile.socialLinks.twitter} target="_blank" rel="noreferrer" className="hover:underline">
                Twitter
              </a>
            )}
            {profile?.socialLinks?.website && (
              <a href={profile.socialLinks.website} target="_blank" rel="noreferrer" className="hover:underline">
                Website
              </a>
            )}
            {profile?.socialLinks?.discord && (
              <span className="text-text-secondary">Discord: {profile.socialLinks.discord}</span>
            )}
          </div>
          <ButtonLink href="/profile/edit">Edit profile</ButtonLink>
        </div>
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
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">Account</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-md border border-border-default bg-bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">Listings</h3>
            <p className="mt-1 text-xs text-text-secondary">Vehicles and listing lifecycle linked to this wallet.</p>
            <p className="mt-3 text-lg font-medium text-accent-warm">{listings.length}</p>
          </article>
          <article className="rounded-md border border-border-default bg-bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">Passports</h3>
            <p className="mt-1 text-xs text-text-secondary">KarPassport NFTs owned by this wallet.</p>
            <p className="mt-3 text-lg font-medium text-accent-warm">{passports.length}</p>
          </article>
          <article className="rounded-md border border-border-default bg-bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">Saved</h3>
            <p className="mt-1 text-xs text-text-secondary">Garage favorites published to Nostr relays.</p>
            <p className="mt-3 text-sm text-text-secondary">Visible below when this wallet has saved listings.</p>
          </article>
          <article className="rounded-md border border-border-default bg-bg-surface p-4">
            <h3 className="text-sm font-medium text-text-primary">Identity</h3>
            <p className="mt-1 text-xs text-text-secondary">Wallet-based profile identity and Kar Pro status.</p>
            <p className="mt-3 text-sm text-text-secondary">
              {karProBal > 0n ? "Kar Pro active on this wallet." : "Kar Pro not active."}
            </p>
          </article>
        </div>
      </section>
      </FadeUp>

      <FadeUp delay={0.1}>
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">Vehicles</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {passports.length === 0 && !ponderErr && (
            <li className="text-sm text-text-secondary">No indexed passports for this wallet.</li>
          )}
          {passports.map((p) => (
            <li key={p.tokenId}>
              <Link
                href={`/marketplace/${p.tokenId}?chain=${chainId}`}
                className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm hover:border-border-hover"
              >
                <span className="font-mono text-accent-warm">#{p.tokenId}</span>
                <span className="ml-2">
                  <PassportStatusBadge status={p.status} />
                </span>
                {p.vin && <span className="ml-2 text-xs text-text-secondary">{p.vin}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      </FadeUp>

      <ProfileFavoritesSection wallet={wallet} />

      {listings.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">Active listings</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {listings.map((l) => (
              <li key={l.tokenId}>
                <Link
                  href={`/marketplace/${l.tokenId}?chain=${chainId}`}
                  className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm hover:border-border-hover"
                >
                  <span className="font-mono text-accent-warm">#{l.tokenId}</span>
                  <span className="ml-2 text-xs text-text-secondary">{l.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center justify-center rounded-sm border border-border-hover px-4 text-sm text-text-primary hover:bg-bg-surface"
    >
      {children}
    </Link>
  );
}
