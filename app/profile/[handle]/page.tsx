import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { getAddress } from "viem";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { getAgentMandateCount, getOwnerMandateCount } from "@/app/actions/commerce-mandates";
import { ProfilePage } from "@/components/profile/profile-page";
import { loadMembershipRoster } from "@/lib/kar-pro/load-membership-roster";
import { karProAnyActive, preferActiveMembershipChainId } from "@/lib/kar-pro/membership-roster";
import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import { commercialChainIds } from "@/lib/web3/chain-context";
import {
  isProtocolAddressOnCommercialChains,
  readAccountKindOnCommercialChains,
} from "@/lib/web3/wallet-account";
import { navShortAddress } from "@/lib/web3/wallet-display";

const getCachedVerifierPublicData = cache(fetchVerifierPublicData);

function parseProfileWallet(raw: string): `0x${string}` | null {
  const handle = decodeURIComponent(raw);
  if (!handle) return null;
  try {
    return getAddress(handle);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: raw } = await params;
  const wallet = parseProfileWallet(raw);
  if (!wallet) return { title: "Profile" };

  const verifierData = await getCachedVerifierPublicData(wallet);
  const name = verifierData.profile?.name?.trim() || navShortAddress(wallet);
  return { title: `${name} — Kargain` };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: raw } = await params;
  const wallet = parseProfileWallet(raw);
  if (!wallet) notFound();

  // Guest tab fallback = first commercial (not hub invent via DEFAULT export).
  // Account kind = commercial OR-union. Passport/listing cards use per-row custody.
  const chainId = commercialChainIds()[0];
  if (chainId == null) notFound();

  if (isProtocolAddressOnCommercialChains(wallet)) notFound();
  const accountKind = await readAccountKindOnCommercialChains(wallet);
  if (accountKind === "contract") notFound();

  const [roster, profileData] = await Promise.all([
    loadMembershipRoster(wallet, { enrichActive: true }),
    getProfileData(wallet),
  ]);

  const isActiveVerifier = karProAnyActive(roster.rows);
  const preferredShowroomChainId = preferActiveMembershipChainId(roster.rows, null);

  let consignedCount: number | null = null;
  if (isActiveVerifier) {
    consignedCount = await getAgentMandateCount(wallet);
  }

  const delegatedCount = await getOwnerMandateCount(wallet);

  let ponderErr: string | null = null;
  let passports: Awaited<ReturnType<typeof getProfileData>>["passports"] = [];
  let listings: Awaited<ReturnType<typeof getProfileData>>["listings"] = [];
  let verifiedPassports: Awaited<
    ReturnType<typeof getCachedVerifierPublicData>
  >["verifiedPassports"] = [];
  let verifierProfile: Awaited<
    ReturnType<typeof getCachedVerifierPublicData>
  >["profile"] = null;
  let attestations: Awaited<
    ReturnType<typeof getCachedVerifierPublicData>
  >["attestations"] = [];

  try {
    // Prefer membership-scoped detail when we know an active chain.
    const verifierData = await getCachedVerifierPublicData(
      wallet,
      preferredShowroomChainId ?? undefined,
    );

    verifierProfile = verifierData.profile;
    verifiedPassports = verifierData.verifiedPassports;
    attestations = verifierData.attestations;

    passports = profileData.passports;
    listings = profileData.listings;
  } catch {
    ponderErr = "PONDER_UNAVAILABLE";
  }

  // Prefer slug from enriched active fact matching preferred chain.
  const preferredFact =
    preferredShowroomChainId != null
      ? roster.activeFacts.find((f) => f.chainId === preferredShowroomChainId)
      : roster.activeFacts[0];
  if (preferredFact?.slug && verifierProfile) {
    verifierProfile = {
      ...verifierProfile,
      slug: preferredFact.slug || verifierProfile.slug,
      name: preferredFact.name || verifierProfile.name,
      chainId: preferredFact.chainId,
    };
  }

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <Suspense fallback={null}>
        <ProfilePage
          wallet={wallet}
          chainId={chainId}
          isActiveVerifier={isActiveVerifier}
          membershipRows={roster.rows}
          activeMembershipFacts={roster.activeFacts}
          preferredShowroomChainId={preferredShowroomChainId}
          verifierProfile={verifierProfile}
          initialNostrProfile={null}
          passports={passports}
          listings={listings}
          verifiedPassports={verifiedPassports}
          attestations={attestations}
          ponderErr={ponderErr}
          consignedCount={consignedCount}
          delegatedCount={delegatedCount}
        />
      </Suspense>
    </div>
  );
}
