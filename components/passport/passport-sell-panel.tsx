"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { AuctionAgentAuthorizationStatus } from "@/components/auction/auction-agent-authorization-status";
import { AuthorizeAuctionAgentDialog } from "@/components/auction/authorize-auction-agent-dialog";
import { CreateAuctionPanel } from "@/components/auction/create-auction-panel";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { AgentAuthorizationStatus } from "@/components/marketplace/agent-authorization-status";
import { AuthorizeAgentDialog } from "@/components/marketplace/authorize-agent-dialog";
import { Button } from "@/components/ui/button";
import type { PassportCommerceFacts } from "@/hooks/use-passport-commerce-facts";
import { useCommerceModePaused } from "@/hooks/use-commerce-mode-paused";
import {
  AUCTION_REQUIRES_VERIFICATION_HINT,
} from "@/lib/auction/sale-form-copy";
import type { AuctionAgentAuth } from "@/lib/auction/auction-agent";
import {
  KarPassportAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import {
  mandateHasAgent,
  type MandateSnapshot,
} from "@/lib/commerce/mandate";
import {
  encumbrancePermissionCopy,
  isEncumbrancePermissionAvailable,
} from "@/lib/passport/encumbrance-permission";
import {
  SELL_AUCTION,
  SELL_AUCTION_RUNNER_NOTE,
  SELL_DELEGATE,
  SELL_DESCRIPTION,
  SELL_HEADING,
  SELL_LIST,
} from "@/lib/passport/sell-copy";
import { deriveSellSurface } from "@/lib/passport/sell-surface";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  karPassportAddress,
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

function ascendingMandateAsAuth(mandate: MandateSnapshot): AuctionAgentAuth {
  return {
    agent: mandate.agent,
    expiry: BigInt(mandate.expiry),
    asset: mandate.asset,
    ownerMinAsset: mandate.floor,
    active: mandate.active,
  };
}

type Props = {
  chainId: number;
  tokenId: string;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  facts: PassportCommerceFacts;
  now: number;
};

/**
 * Owner sell group for FixedPrice + Ascending modes (mandate grant / open).
 * Chrome matches Bridge (Level B card + secondary full-width CTAs). Permission
 * is `may(OpenConsignment)` + no live consignment. Ascending self-open
 * additionally requires VERIFIED (mirrors chain); blocked self-open keeps a
 * dimmed Auction CTA with named status copy.
 */
export function PassportSellPanel({
  chainId,
  tokenId,
  passportOwner,
  passportStatus,
  facts,
  now,
}: Props) {
  const { address, isConnected } = useAccount();
  const [fixedPriceDialogOpen, setFixedPriceDialogOpen] = useState(false);
  const [ascendingDialogOpen, setAscendingDialogOpen] = useState(false);

  const passport = karPassportAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);
  const { paused: fixedPricePaused } = useCommerceModePaused({
    mode: "fixedPrice",
    chainId,
  });
  const { paused: ascendingPaused } = useCommerceModePaused({
    mode: "ascending",
    chainId,
  });

  const { data: onChainOwner, refetch: refetchOwner } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "ownerOf",
    args: [tid],
    chainId: wc,
    query: { enabled: Boolean(passport) },
  });

  const { data: isActiveVerifier, refetch: refetchVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wc,
    query: { enabled: Boolean(staking && address) },
  });

  const effectiveOwner = resolveEffectiveOnChainOwner(
    onChainOwner as `0x${string}` | undefined,
    passportOwner,
  );
  const isOwner =
    isConnected &&
    address != null &&
    isOnChainNftOwner(address, effectiveOwner);

  const surface = deriveSellSurface({
    isOwner: Boolean(isOwner),
    hasLiveConsignment: facts.hasLiveConsignment,
    fixedPriceConfigured: facts.fixedPrice.configured,
    ascendingConfigured: facts.ascending.configured,
    openConsignmentPermission: facts.openConsignmentPermission,
    isActiveVerifier:
      isActiveVerifier === undefined ? undefined : isActiveVerifier === true,
    passportStatus,
    fixedPriceMandate:
      facts.fixedPrice.mandate === undefined
        ? undefined
        : { value: facts.fixedPrice.mandate, now },
    ascendingMandate:
      facts.ascending.mandate === undefined
        ? undefined
        : { value: facts.ascending.mandate, now },
  });

  const refetch = () => {
    facts.refetch();
    void refetchOwner();
    void refetchVerifier();
  };

  if (!isOwner) return null;

  const fixedMandate = facts.fixedPrice.mandate;
  const ascendingMandate = facts.ascending.mandate;
  const anyVisible =
    surface.showFixedPriceOpen ||
    surface.showFixedPriceGrant ||
    surface.showFixedPriceMandateCard ||
    surface.ascendingSelfOpen != null ||
    surface.showAscendingGrant ||
    surface.showAscendingMandateCard ||
    surface.showAscendingRunnerNote;

  if (!anyVisible) {
    const openGate = facts.openConsignmentPermission;
    if (openGate.status === "blocked") {
      // Unresolved is waiting copy; refused / unanswerable are definite facts.
      // Hide only when modes are missing and permission is available-shaped
      // unread would still show waiting — openGate is always blocked or available.
      if (
        openGate.cause !== "reads_unresolved" ||
        facts.fixedPrice.configured ||
        facts.ascending.configured
      ) {
        const copy = encumbrancePermissionCopy(openGate, "openConsignment");
        if (copy) {
          return <p className="text-sm text-text-secondary">{copy}</p>;
        }
      }
    }
    if (!facts.fixedPrice.configured && !facts.ascending.configured) {
      return (
        <p className="text-sm text-text-secondary">
          Commerce modes are not deployed on this network yet.
        </p>
      );
    }
    return null;
  }

  const canOpen =
    isEncumbrancePermissionAvailable(facts.openConsignmentPermission) &&
    facts.hasLiveConsignment === false;

  const selfOpen = surface.ascendingSelfOpen;

  return (
    <section className="space-y-3 rounded-md border border-border-default bg-bg-card p-4">
      <h2 className="font-sans text-base font-medium text-text-primary">
        {SELL_HEADING}
      </h2>
      <p className="font-sans text-sm text-text-secondary">{SELL_DESCRIPTION}</p>

      {fixedPricePaused === true || ascendingPaused === true ? (
        <CommercePausedNotice />
      ) : null}

      {surface.showFixedPriceOpen && fixedPricePaused !== true ? (
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/marketplace/${tokenId}/edit?chain=${chainId}`}>
            {SELL_LIST}
          </Link>
        </Button>
      ) : null}

      {surface.showFixedPriceMandateCard &&
      fixedMandate &&
      mandateHasAgent(fixedMandate) ? (
        <AgentAuthorizationStatus
          chainId={chainId}
          tokenId={tokenId}
          mandate={fixedMandate}
          listingActive={facts.fixedPrice.live === true}
          onChanged={refetch}
        />
      ) : null}

      {surface.showFixedPriceGrant ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setFixedPriceDialogOpen(true)}
        >
          {SELL_DELEGATE}
        </Button>
      ) : null}

      {surface.showAscendingRunnerNote ? (
        <p className="font-sans text-sm text-text-secondary">
          {SELL_AUCTION_RUNNER_NOTE}
        </p>
      ) : null}

      {selfOpen?.status === "blocked" ? (
        <p className="font-sans text-sm text-text-secondary" role="status">
          {AUCTION_REQUIRES_VERIFICATION_HINT}
        </p>
      ) : null}

      {surface.showAscendingMandateCard &&
      ascendingMandate &&
      mandateHasAgent(ascendingMandate) ? (
        <AuctionAgentAuthorizationStatus
          authorization={ascendingMandateAsAuth(ascendingMandate)}
          now={now}
          onManage={() => setAscendingDialogOpen(true)}
        />
      ) : null}

      {selfOpen?.status === "available" ? (
        <CreateAuctionPanel
          chainId={chainId}
          tokenId={tokenId}
          canOpen={canOpen}
          isOwner
          isActiveVerifier={isActiveVerifier === true}
        />
      ) : null}

      {selfOpen?.status === "blocked" ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled
          aria-disabled="true"
        >
          {SELL_AUCTION}
        </Button>
      ) : null}

      {surface.showAscendingGrant ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setAscendingDialogOpen(true)}
        >
          {SELL_AUCTION}
        </Button>
      ) : null}

      <AuthorizeAgentDialog
        chainId={chainId}
        tokenId={tokenId}
        open={fixedPriceDialogOpen}
        onOpenChange={setFixedPriceDialogOpen}
        onAuthorized={refetch}
      />
      <AuthorizeAuctionAgentDialog
        chainId={chainId}
        tokenId={tokenId}
        open={ascendingDialogOpen}
        onOpenChange={setAscendingDialogOpen}
        onAuthorized={refetch}
      />
    </section>
  );
}
