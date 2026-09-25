import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { getAgentMandateCount, getOwnerMandateCount } from "@/app/actions/commerce-mandates";
import { ProfilePage } from "@/components/profile/profile-page";
import { loadMembershipRoster } from "@/lib/kar-pro/load-membership-roster";
import { karProAnyActive, preferActiveMembershipChainId } from "@/lib/kar-pro/membership-roster";
import { isEvmHexAddress } from "@/lib/passport/passport-owner";
import {
  profileSectionSupportMap,
} from "@/lib/profile/profile-section-support";
import {
  profileGuestEvmChainId,
  resolveProfileSubject,
} from "@/lib/profile/resolve-profile-subject";
import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import { readAccountKindOnCommercialChains } from "@/lib/web3/wallet-account";
import { navShortAddress } from "@/lib/web3/wallet-display";

const getCachedVerifierPublicData = cache(fetchVerifierPublicData);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: raw } = await params;
  const subject = resolveProfileSubject(raw);
  if (subject.status !== "found") return { title: "Profile" };

  if (!isEvmHexAddress(subject.owner)) {
    return { title: `${navShortAddress(subject.owner)} — Kargain` };
  }

  const verifierData = await getCachedVerifierPublicData(subject.owner);
  const name = verifierData.profile?.name?.trim() || navShortAddress(subject.owner);
  return { title: `${name} — Kargain` };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: raw } = await params;
  const subject = resolveProfileSubject(raw);
  if (subject.status !== "found") notFound();

  const { owner, namespaces } = subject;
  const sections = profileSectionSupportMap(namespaces);
  const guestChainId = profileGuestEvmChainId(namespaces);

  // Contract accounts are not profiles (EVM bytecode OR across commercial EIP-155).
  if (isEvmHexAddress(owner)) {
    const accountKind = await readAccountKindOnCommercialChains(owner);
    if (accountKind === "contract") notFound();
  }

  const karProAvailable = sections.kar_pro.available;
  const listingsAvailable = sections.listings.available;
  const passportsAvailable = sections.passports.available;

  const [roster, profileData] = await Promise.all([
    karProAvailable && isEvmHexAddress(owner)
      ? loadMembershipRoster(owner, { enrichActive: true })
      : Promise.resolve({ rows: [], activeFacts: [] }),
    passportsAvailable
      ? getProfileData(owner, { includeListings: listingsAvailable })
      : Promise.resolve({ passports: [], listings: [] }),
  ]);

  const isActiveVerifier = karProAvailable
    ? karProAnyActive(roster.rows)
    : false;
  const preferredShowroomChainId = karProAvailable
    ? preferActiveMembershipChainId(roster.rows, null)
    : null;

  let consignedCount: number | null = null;
  let delegatedCount: number | null = null;
  if (sections.consigned.available && isActiveVerifier && isEvmHexAddress(owner)) {
    consignedCount = await getAgentMandateCount(owner);
  }
  if (sections.delegated.available && isEvmHexAddress(owner)) {
    delegatedCount = await getOwnerMandateCount(owner);
  }

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
    if (
      (sections.verified.available || sections.attestations.available) &&
      isEvmHexAddress(owner)
    ) {
      const verifierData = await getCachedVerifierPublicData(
        owner,
        preferredShowroomChainId ?? undefined,
      );
      verifierProfile = verifierData.profile;
      verifiedPassports = verifierData.verifiedPassports;
      attestations = verifierData.attestations;
    }

    passports = profileData.passports;
    listings = listingsAvailable ? profileData.listings : [];
  } catch {
    ponderErr = "PONDER_UNAVAILABLE";
  }

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
          wallet={owner}
          chainId={guestChainId}
          namespaces={namespaces}
          sectionSupport={sections}
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
