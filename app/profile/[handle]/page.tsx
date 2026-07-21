import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { getAddress } from "viem";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { getAgentConsignmentCount } from "@/app/actions/agent-consignment";
import { getOwnerDelegatedCount } from "@/app/actions/owner-consignment";
import { ProfilePage } from "@/components/profile/profile-page";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  mapProfileListing,
  mapProfilePassport,
} from "@/lib/passport/map-profile-passport";
import { fetchVerifierPublicData } from "@/lib/verifier/fetch-verifier-public-data";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import {
  isProtocolAddressOnCommercialChains,
  readAccountKind,
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

async function readIsActiveVerifier(
  chainId: number,
  wallet: `0x${string}`,
): Promise<boolean> {
  const staking = karProStakingAddress(chainId);
  if (!staking) return false;
  try {
    return await getPublicClient(chainId).readContract({
      address: staking,
      abi: KarProStakingAbi,
      functionName: "isActiveVerifier",
      args: [wallet],
    });
  } catch {
    return false;
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

  // Hub-scoped for KarPro stake / account-kind until Eth KarPro is productized.
  const chainId = DEFAULT_CHAIN_ID;

  if (isProtocolAddressOnCommercialChains(wallet)) notFound();
  const accountKind = await readAccountKind(chainId, wallet);
  if (accountKind === "contract") notFound();

  const [isActiveVerifier, profileData] = await Promise.all([
    readIsActiveVerifier(chainId, wallet),
    getProfileData(wallet),
  ]);

  let consignedCount: number | null = null;
  if (isActiveVerifier) {
    const countResult = await getAgentConsignmentCount(wallet);
    if (countResult.count != null && !countResult.ponderError) {
      consignedCount = countResult.count;
    }
  }

  let delegatedCount: number | null = null;
  {
    const countResult = await getOwnerDelegatedCount(wallet);
    if (countResult.count != null && !countResult.ponderError) {
      delegatedCount = countResult.count;
    }
  }

  let ponderErr: string | null = null;
  let passports: NonNullable<ReturnType<typeof mapProfilePassport>>[] = [];
  let listings: NonNullable<ReturnType<typeof mapProfileListing>>[] = [];
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

    passports = (profileData.passports as unknown[])
      .map(mapProfilePassport)
      .filter((p): p is NonNullable<typeof p> => p != null);
    listings = (profileData.listings as unknown[])
      .map(mapProfileListing)
      .filter((l): l is NonNullable<typeof l> => l != null);
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
          disputedPassports={verifierProfile?.disputedPassports ?? []}
          attestations={attestations}
          ponderErr={ponderErr}
          consignedCount={consignedCount}
          delegatedCount={delegatedCount}
        />
      </Suspense>
    </div>
  );
}
