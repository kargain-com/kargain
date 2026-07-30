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
import type { AuctionAgentAuth } from "@/lib/auction/auction-agent";
import {
  KarPassportAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import {
  mandateHasAgent,
  type MandateSnapshot,
} from "@/lib/commerce/mandate";
import { deriveSellSurface } from "@/lib/passport/sell-surface";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
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
  facts: PassportCommerceFacts;
  now: number;
};

/**
 * Owner sell group for FixedPrice + Ascending modes (mandate grant / open).
 * Permission is `may(OpenConsignment)` + no live consignment — not trust status.
 */
export function PassportSellPanel({
  chainId,
  tokenId,
  passportOwner,
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
    mayOpenConsignment: facts.mayOpenConsignment,
    isActiveVerifier:
      isActiveVerifier === undefined ? undefined : isActiveVerifier === true,
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
    surface.showAscendingOpen ||
    surface.showAscendingGrant ||
    surface.showAscendingMandateCard ||
    surface.showAscendingRunnerNote;

  if (!anyVisible) {
    if (facts.mayOpenConsignment === false) {
      return (
        <p className="text-sm text-text-secondary">
          This passport cannot open a consignment right now.
        </p>
      );
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

  return (
    <div className="space-y-4 rounded-md border border-border-subtle bg-bg-surface p-4">
      <h2 className="text-sm tracking-wide text-text-secondary">Sell</h2>

      {fixedPricePaused === true || ascendingPaused === true ? (
        <CommercePausedNotice />
      ) : null}

      {surface.showFixedPriceOpen ? (
        <div className="space-y-2">
          {fixedPricePaused === true ? null : (
            <Button asChild variant="secondary" className="w-full sm:w-auto">
              <Link href={`/marketplace/${tokenId}/edit?chain=${chainId}`}>
                Open fixed-price consignment
              </Link>
            </Button>
          )}
        </div>
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
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => setFixedPriceDialogOpen(true)}
        >
          Grant fixed-price mandate
        </Button>
      ) : null}

      {surface.showAscendingRunnerNote ? (
        <p className="text-sm text-text-secondary">
          Ascending auctions are opened by an active KarPro verifier. Grant a
          mandate to let a pro run the lot for you.
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

      {surface.showAscendingOpen ? (
        <CreateAuctionPanel
          chainId={chainId}
          tokenId={tokenId}
          canOpen={facts.mayOpenConsignment === true && facts.hasLiveConsignment === false}
          isOwner
          isActiveVerifier={isActiveVerifier === true}
        />
      ) : null}

      {surface.showAscendingGrant ? (
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => setAscendingDialogOpen(true)}
        >
          Grant ascending mandate
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
    </div>
  );
}
