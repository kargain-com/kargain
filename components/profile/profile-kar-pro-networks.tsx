import Link from "next/link";

import {
  VerificationFeeDisplay,
} from "@/components/verifier/verification-fee-display";
import { categoryLabel, instrumentReadoutPanel, monoLinkSm } from "@/lib/design/instrument-classes";
import type { KarProActiveMembershipFact } from "@/lib/kar-pro/membership-roster";
import { proShowroomHref } from "@/lib/kar-pro/pro-showroom-href";
import { shortChainName } from "@/lib/web3/supported-chains";

type ProfileKarProNetworksProps = {
  facts: readonly KarProActiveMembershipFact[];
  isOwner: boolean;
};

/**
 * Public/owner list of active KarPro memberships (per-network fee + count).
 * Owner manages switch/join on `/kar-pro` — no duplicate Switch CTAs here.
 */
export function ProfileKarProNetworks({ facts, isOwner }: ProfileKarProNetworksProps) {
  if (facts.length === 0) return null;

  return (
    <div className={`${instrumentReadoutPanel} space-y-1`}>
      <div className="space-y-1">
        <p className={categoryLabel}>KarPro networks</p>
        <p className="font-sans text-xs text-text-secondary">
          Membership, verification fee, and showroom credentials are per network.
        </p>
      </div>
      <ul className="mt-4 divide-y divide-border-default">
        {facts.map((fact) => {
          const name = shortChainName(fact.chainId);
          return (
            <li
              key={fact.chainId}
              className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-sans text-sm text-text-primary">
                  {name}{" "}
                  <span className="font-mono text-xs tabular-nums text-text-tertiary">
                    ({fact.chainId})
                  </span>
                </p>
                <p className="font-mono text-xs text-text-secondary">
                  <span className="tabular-nums text-text-primary">
                    {fact.verificationCount}
                  </span>{" "}
                  verification{fact.verificationCount === 1 ? "" : "s"}
                  {fact.verificationFee != null ? (
                    <>
                      {" · "}
                      <VerificationFeeDisplay
                        feeWei={fact.verificationFee}
                        prefix="Fee "
                        primaryClassName="font-mono text-xs text-text-secondary tabular-nums"
                      />
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3 pt-0.5">
                {fact.slug ? (
                  <Link
                    href={proShowroomHref(fact.slug, fact.chainId)}
                    className={monoLinkSm}
                  >
                    Showroom →
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {isOwner ? (
        <p className="border-t border-border-default pt-4">
          <Link href="/kar-pro" className={monoLinkSm}>
            Manage networks →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
