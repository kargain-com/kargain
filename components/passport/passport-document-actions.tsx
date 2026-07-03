"use client";

import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { usePassportPanelUrl } from "@/components/passport/passport-detail-panel-chrome";
import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import { cn } from "@/lib/utils";

type Props = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
};

function IndicatorDot({ tone }: { tone: "warm" | "error" }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "warm" ? "bg-accent-warm" : "bg-status-error",
      )}
      aria-hidden
    />
  );
}

export function PassportDocumentActions({
  status,
  passportOwner,
  chainId,
  tokenId,
}: Props) {
  const { openPanel } = usePassportPanelUrl();
  const { address } = useAccount();
  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);
  const isOwner = isOnChainNftOwner(address, effectiveOwner);
  const isDisputed = status === "DISPUTED";
  const showActionsDot = isDisputed && isOwner;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => openPanel("records")}
      >
        {isDisputed ? <IndicatorDot tone="warm" /> : null}
        History & records
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => openPanel("actions")}
      >
        {showActionsDot ? <IndicatorDot tone="error" /> : null}
        Actions
      </Button>
    </div>
  );
}
