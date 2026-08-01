"use client";

import type { OwnerMandateTermsReadout } from "@/lib/commerce/owner-mandate-readout";

type Props = {
  readout: OwnerMandateTermsReadout;
};

/**
 * Factual owner terms + proceeds from {@link deriveOwnerMandateReadout}.
 * Body copy is already composed in the pure module — not a warning.
 */
export function OwnerMandateTerms({ readout }: Props) {
  return (
    <div className="mt-3 space-y-1.5 border-t border-border-default pt-3 text-sm">
      <dl className="space-y-1">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
          <dt className="text-text-secondary">Compensation</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {readout.formLabel}
            {readout.rateLabel != null ? ` · ${readout.rateLabel}` : null}
          </dd>
        </div>
        {readout.floorLabel != null ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-text-secondary">Floor</dt>
            <dd className="font-mono tabular-nums text-text-primary">
              {readout.floorLabel}
            </dd>
          </div>
        ) : null}
        {readout.proceeds.kind === "variable" ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-text-secondary">You receive</dt>
            <dd className="font-mono tabular-nums text-text-primary">
              {readout.proceeds.amountLabel}
            </dd>
          </div>
        ) : null}
      </dl>
      {readout.proceeds.kind === "fixed" ? (
        <p className="text-xs text-text-secondary">{readout.proceeds.statement}</p>
      ) : null}
      {readout.proceeds.kind === "variable" ? (
        <p className="text-xs text-text-secondary">
          {readout.proceeds.movesWithPrice}
        </p>
      ) : null}
      {readout.proceeds.kind === "absent" ? (
        <p className="text-xs text-text-secondary">{readout.ownerReceives}</p>
      ) : null}
    </div>
  );
}
