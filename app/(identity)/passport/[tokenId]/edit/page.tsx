import { notFound } from "next/navigation";

import { EditPassportWizard } from "@/components/passport/edit-passport-wizard";
import { EmptyState } from "@/components/ui/empty-state";
import {
  editMetadataRefusalCopy,
  resolvePassportEditAccess,
  type PassportEditRefusalCause,
} from "@/lib/passport/action-surface";
import { fetchPassportDetail } from "@/lib/passport/fetch-passport-detail";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { PassportPresence } from "@/lib/passport/presence";
import { parsePassportTokenId } from "@/lib/passport/passport-token-id";
import { commerceModeAddresses } from "@/lib/commerce/mode";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";
import { getPublicClient } from "@/lib/web3/public-client";

function marketplaceDetailHref(tokenId: string, chainId: number | undefined) {
  if (chainId == null) return `/marketplace/${tokenId}`;
  return `/marketplace/${tokenId}?chain=${chainId}`;
}

function EditRefusalShell({
  tokenId,
  chainId,
  cause,
  presence,
  title,
}: {
  tokenId: string;
  chainId: number | undefined;
  cause: PassportEditRefusalCause;
  presence: PassportPresence;
  title: string;
}) {
  return (
    <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
      <div className="mx-auto max-w-lg">
        <EmptyState
          variant="content"
          level="B"
          title={title}
          description={editMetadataRefusalCopy(cause, presence)}
          action={{
            label: "← Back to passport",
            href: marketplaceDetailHref(tokenId, chainId),
          }}
        />
      </div>
    </div>
  );
}

const REFUSAL_TITLE: Record<PassportEditRefusalCause, string> = {
  away: "Passport is on another chain",
  reads_unresolved: "Location could not be read",
  custody_unresolved: "Passport location is unresolved",
  disputed: "Passport is under challenge",
  listing_active: "Passport is held for sale",
  not_configured: "Passport not available on this chain",
};

export default async function EditPassportPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const { tokenId } = await params;
  const sp = await searchParams;

  if (!/^\d+$/.test(tokenId)) notFound();

  const fromUrl = parseOptionalChainParam(sp.chain);
  const parsed = parsePassportTokenId(tokenId);
  const hint =
    fromUrl ?? (parsed.isV2Prefixed ? parsed.chainId : null);

  const result = await fetchPassportDetail(tokenId, hint);

  if (!result.ok && result.error === "NOT_FOUND") {
    notFound();
  }

  if (!result.ok && result.error === "PONDER_UNAVAILABLE") {
    return (
      <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
        <div className="mx-auto max-w-lg">
          <EmptyState
            variant="infrastructure"
            level="B"
            title="Passport data could not be loaded"
            description="Try again in a moment."
            role="status"
            action={{
              label: "← Back to marketplace",
              href: "/",
            }}
          />
        </div>
      </div>
    );
  }

  if (!result.ok) {
    notFound();
  }

  const { passport, metadata } = result;
  const originOrHint = passport.chainId;

  // Location gap — named refusal, never notFound (§4.21).
  if (passport.custodyUnresolved || passport.custodyChain == null) {
    const access = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: originOrHint,
        custodyLocked: undefined,
        ponderCustodyChain: passport.custodyChain,
        custodyUnresolved: passport.custodyUnresolved ?? null,
      },
      status: passport.status,
      listingActive: false,
      configured: true,
    });
    if (access.status === "refuse") {
      return (
        <EditRefusalShell
          tokenId={tokenId}
          chainId={passport.custodyChain ?? originOrHint}
          cause={access.cause}
          presence={access.presence}
          title={REFUSAL_TITLE[access.cause]}
        />
      );
    }
  }

  if (passport.custodyChain == null) {
    // Fail closed: unresolved without a refuse path must still not invent edit.
    const access = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: originOrHint,
        custodyLocked: undefined,
        ponderCustodyChain: null,
        custodyUnresolved: null,
      },
      status: passport.status,
      listingActive: false,
      configured: true,
    });
    if (access.status === "refuse") {
      return (
        <EditRefusalShell
          tokenId={tokenId}
          chainId={originOrHint}
          cause={access.cause}
          presence={access.presence}
          title={REFUSAL_TITLE[access.cause]}
        />
      );
    }
  }

  const chainId = passport.custodyChain!;

  if (passport.status === "DISPUTED") {
    const access = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: chainId,
        custodyLocked: false,
        ponderCustodyChain: chainId,
      },
      status: passport.status,
      listingActive: false,
      configured: true,
    });
    if (access.status === "refuse") {
      return (
        <EditRefusalShell
          tokenId={tokenId}
          chainId={chainId}
          cause={access.cause}
          presence={access.presence}
          title={REFUSAL_TITLE[access.cause]}
        />
      );
    }
  }

  const passportAddr = karPassportAddress(chainId);
  const modeCustodians = Object.values(commerceModeAddresses(chainId)).map(
    (address) => address.toLowerCase(),
  );

  if (!passportAddr) {
    const access = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: chainId,
        custodyLocked: false,
        ponderCustodyChain: chainId,
      },
      status: passport.status,
      listingActive: false,
      configured: false,
    });
    if (access.status === "refuse") {
      return (
        <EditRefusalShell
          tokenId={tokenId}
          chainId={chainId}
          cause={access.cause}
          presence={access.presence}
          title={REFUSAL_TITLE[access.cause]}
        />
      );
    }
  }

  let listingActive = false;
  let presenceFacts: {
    viewChainId: number;
    custodyLocked: boolean | undefined;
    ponderCustodyChain: number | null;
    custodyUnresolved?: string | null;
  } = {
    viewChainId: chainId,
    custodyLocked: undefined,
    ponderCustodyChain: passport.custodyChain,
    custodyUnresolved: passport.custodyUnresolved,
  };

  try {
    const client = getPublicClient(chainId);
    const [owner, custodyLocked] = await Promise.all([
      client.readContract({
        address: passportAddr!,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        address: passportAddr!,
        abi: KarPassportAbi,
        functionName: "custodyLocked",
        args: [BigInt(tokenId)],
      }),
    ]);

    presenceFacts = {
      viewChainId: chainId,
      custodyLocked: Boolean(custodyLocked),
      ponderCustodyChain: passport.custodyChain,
      custodyUnresolved: passport.custodyUnresolved,
    };
    listingActive =
      modeCustodians.length > 0 &&
      modeCustodians.includes(owner.toLowerCase());
  } catch {
    // Fail closed: setPassportURI is gated by custody lock — unread → no edit.
    presenceFacts = {
      viewChainId: chainId,
      custodyLocked: undefined,
      ponderCustodyChain: passport.custodyChain,
      custodyUnresolved: passport.custodyUnresolved,
    };
    listingActive = false;
  }

  const access = resolvePassportEditAccess({
    presenceFacts,
    status: passport.status,
    listingActive,
    configured: true,
  });

  if (access.status === "refuse") {
    return (
      <EditRefusalShell
        tokenId={tokenId}
        chainId={chainId}
        cause={access.cause}
        presence={access.presence}
        title={REFUSAL_TITLE[access.cause]}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <EditPassportWizard
        tokenId={tokenId}
        chainId={chainId}
        status={passport.status}
        initialMetadata={metadata}
        existingPhotoUris={metadata?.photos ?? []}
      />
    </div>
  );
}
