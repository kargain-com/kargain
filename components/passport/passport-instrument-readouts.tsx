import Link from "next/link";

import { PassportChainStatusBanner } from "@/components/passport/passport-chain-status-banner";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { PassportTrustBanner } from "@/components/passport/passport-trust-banner";
import { VerifierInactiveInline } from "@/components/passport/verifier-inactive-badge";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  instrumentReadoutPanel,
  sansLinkUnderline,
} from "@/lib/design/instrument-classes";
import type { PassportCustody } from "@/lib/marketplace/passport-custody";
import type { PassportStatus } from "@/lib/types/ponder";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";
import { cn } from "@/lib/utils";

type Props = {
  tokenId: string;
  chainId: number;
  status: PassportStatus;
  verifier: string;
  verifiedAt: string;
  custody: PassportCustody;
  passportOwner: `0x${string}`;
  verificationResetCount: number;
  hadDispute: boolean;
  duplicateVin: boolean;
  showG2Banner: boolean;
  className?: string;
};

function formatChainDate(timestampSec: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

export function PassportInstrumentReadouts({
  tokenId,
  chainId,
  status,
  verifier,
  verifiedAt,
  custody,
  passportOwner,
  verificationResetCount,
  hadDispute,
  duplicateVin,
  showG2Banner,
  className,
}: Props) {
  const verifiedDate = formatChainDate(verifiedAt);
  const hasVerifier =
    status === "VERIFIED" &&
    verifier.trim() &&
    verifier !== "0x0000000000000000000000000000000000000000";

  return (
    <section className={cn(instrumentReadoutPanel, "mt-4 space-y-4", className)}>
      <div>
        <PassportIdLabel tokenId={tokenId} chainId={chainId} variant="eyebrow" />
      </div>

      <p className="font-sans text-sm text-text-secondary">
        {custody.isEscrowed ? (
          <>
            Seller{" "}
            <EnsWalletLink
              address={custody.profileAddress}
              href={`/profile/${custody.profileAddress}`}
              className="hover:underline"
            />
            <span className="mx-1 text-text-tertiary">·</span>
            Held in escrow{" "}
            <EnsWalletLink
              address={custody.custodyAddress ?? passportOwner}
              externalHref={explorerAddressUrl(
                chainId,
                custody.custodyAddress ?? passportOwner,
              )}
              className="hover:underline"
            />
          </>
        ) : (
          <>
            On-chain owner{" "}
            <EnsWalletLink
              address={custody.profileAddress}
              href={`/profile/${custody.profileAddress}`}
              className="hover:underline"
            />
          </>
        )}
      </p>

      <PassportChainStatusBanner
        tokenId={tokenId}
        ponderStatus={status}
        chainId={chainId}
      />

      {hasVerifier && (
        <p className="font-sans text-sm text-text-secondary">
          Verified by{" "}
          <EnsWalletLink
            address={verifier}
            href={`/profile/${verifier}`}
            className="hover:underline"
          />
          {verifiedDate && (
            <>
              {" "}
              on <span className="font-mono tabular-nums">{verifiedDate}</span>
            </>
          )}
          <VerifierInactiveInline chainId={chainId} verifier={verifier} />
        </p>
      )}

      {status === "UNVERIFIED" && (
        <p className="font-sans text-sm text-text-secondary">
          Not independently verified —{" "}
          <Link href="/verifiers" className={sansLinkUnderline}>
            find a KarPro verifier to inspect
          </Link>
          .
        </p>
      )}

      {status !== "DISPUTED" && (
        <PassportTrustBanner
          verificationResetCount={verificationResetCount}
          hadDispute={hadDispute}
          status={status}
        />
      )}

      {showG2Banner && (
        <div
          className="rounded-md border border-accent-warm/40 bg-bg-primary/80 p-4"
          role="status"
        >
          <p className="font-sans text-sm text-text-primary">
            Fixed after dispute — awaiting re-verification. Metadata was updated after the last
            dispute or reset.
          </p>
        </div>
      )}

      {duplicateVin && (
        <p
          className={cn(elevatedAdvisoryPanel, elevatedAdvisoryText)}
          role="status"
        >
          Duplicate VIN warning — another passport shares this VIN in the index.
        </p>
      )}
    </section>
  );
}
