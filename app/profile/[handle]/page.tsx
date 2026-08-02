import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { getAddress } from "viem";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { getAgentMandateCount, getOwnerMandateCount } from "@/app/actions/commerce-mandates";
import { ProfilePage } from "@/components/profile/profile-page";
import { isActiveVerifierOnCommercialChains } from "@/lib/kar-pro/is-active-verifier-commercial";
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

  const [isActiveVerifier, profileData] = await Promise.all([
    isActiveVerifierOnCommercialChains(wallet),
    getProfileData(wallet),
  ]);

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
    const verifierData = await getCachedVerifierPublicData(wallet);

    verifierProfile = verifierData.profile;
    verifiedPassports = verifierData.verifiedPassports;
    attestations = verifierData.attestations;

    passports = profileData.passports;
    listings = profileData.listings;
  } catch {
    ponderErr = "PONDER_UNAVAILABLE";
  }

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <Suspense fallback={null}>
        <ProfilePage
          wallet={wallet}
          chainId={chainId}
          isActiveVerifier={isActiveVerifier}
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
