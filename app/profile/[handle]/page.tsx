import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { getAddress } from "viem";

import { fetchKarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import {
  getPassportsByVerifier,
  getProfileData,
} from "@/app/actions/marketplace-listings";
import { getVerifierAttestations } from "@/app/actions/verifier-attestations";
import { ProfilePage } from "@/components/profile/profile-page";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { fetchNostrProfileServerFull } from "@/lib/nostr/fetch-profile-server";
import type { PassportStatus } from "@/lib/types/ponder";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import { navShortAddress } from "@/lib/web3/wallet-display";

const getCachedVerifierProfile = cache(fetchKarProVerifierProfile);

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

  const verifierProfile = await getCachedVerifierProfile(wallet);
  const name = verifierProfile?.name?.trim() || navShortAddress(wallet);
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

  const chainId = DEFAULT_CHAIN_ID;

  const [isActiveVerifier, profileData, initialNostrProfile] = await Promise.all([
    readIsActiveVerifier(chainId, wallet),
    getProfileData(wallet),
    fetchNostrProfileServerFull(wallet),
  ]);

  let ponderErr: string | null = null;
  let passports: {
    tokenId: string;
    status: PassportStatus;
    vin?: string | null;
  }[] = [];
  let listings: {
    tokenId: string;
    passportStatus: PassportStatus;
    make?: string;
    model?: string;
  }[] = [];
  let verifiedPassports: Awaited<ReturnType<typeof getPassportsByVerifier>> = [];
  let verifierProfile: Awaited<ReturnType<typeof fetchKarProVerifierProfile>> = null;
  let attestations: Awaited<ReturnType<typeof getVerifierAttestations>>["attestations"] = [];

  try {
    const [verifier, verified, attestationsResult] = await Promise.all([
      isActiveVerifier ? getCachedVerifierProfile(wallet) : Promise.resolve(null),
      isActiveVerifier ? getPassportsByVerifier(wallet) : Promise.resolve([]),
      isActiveVerifier ? getVerifierAttestations(wallet) : Promise.resolve(null),
    ]);

    verifierProfile = verifier;
    verifiedPassports = verified;
    attestations = attestationsResult?.attestations ?? [];

    passports = (profileData.passports as Array<Record<string, unknown>>).map((p) => ({
      tokenId: String(p.id ?? ""),
      status: (p.status as PassportStatus) ?? "UNVERIFIED",
      vin: typeof p.vin === "string" && p.vin ? p.vin : null,
    }));
    listings = (profileData.listings as Array<Record<string, unknown>>)
      .filter((l) => l.active === true)
      .map((l) => ({
        tokenId: String(l.tokenId ?? l.id ?? ""),
        passportStatus: (l.passportStatus as PassportStatus) ?? "UNVERIFIED",
        make: typeof l.make === "string" ? l.make : undefined,
        model: typeof l.model === "string" ? l.model : undefined,
      }));
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
          initialNostrProfile={initialNostrProfile}
          passports={passports}
          listings={listings}
          verifiedPassports={verifiedPassports}
          disputedPassports={verifierProfile?.disputedPassports ?? []}
          attestations={attestations}
          ponderErr={ponderErr}
        />
      </Suspense>
    </div>
  );
}
