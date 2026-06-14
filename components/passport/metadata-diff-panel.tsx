"use client";

import { useEffect, useMemo, useState } from "react";

import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { fetchArweaveMetadata } from "@/lib/passport/fetch-arweave-metadata";
import {
  diffPassportMetadata,
  pickMetadataDiffUris,
  recommendsReInspection,
  type PassportMetadataDiff,
} from "@/lib/passport/metadata-diff";
import type { PonderUriHistoryEntry } from "@/lib/types/ponder";

type Props = {
  uriHistory: PonderUriHistoryEntry[];
  currentTokenUri: string;
  currentMetadata: PassportMetadata | null;
  verificationResetCount: number;
  lastVerificationResetAt: string;
};

function DiffList({
  title,
  changes,
  variant,
}: {
  title: string;
  changes: PassportMetadataDiff["anchor"];
  variant: "anchor" | "cosmetic";
}) {
  if (changes.length === 0) return null;
  return (
    <div>
      <p
        className={
          variant === "anchor"
            ? "font-medium text-status-error"
            : "font-medium text-text-primary"
        }
      >
        {title}
      </p>
      <ul className="mt-1 list-disc pl-5 text-sm text-text-secondary">
        {changes.map((change) => (
          <li key={change.field}>
            {change.field}: {change.before || "—"} → {change.after || "—"}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MetadataDiffPanel({
  uriHistory,
  currentTokenUri,
  currentMetadata,
  verificationResetCount,
  lastVerificationResetAt,
}: Props) {
  const uriPair = useMemo(
    () => pickMetadataDiffUris(uriHistory, currentTokenUri),
    [uriHistory, currentTokenUri],
  );
  const showReInspect = recommendsReInspection({
    verificationResetCount,
    lastVerificationResetAt,
    uriHistory,
  });

  const [beforeMetadata, setBeforeMetadata] = useState<PassportMetadata | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!uriPair) {
      setBeforeMetadata(null);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setLoadError(false);

    void fetchArweaveMetadata(uriPair.beforeUri).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setBeforeMetadata(null);
        setLoadError(true);
        return;
      }
      setBeforeMetadata(result.metadata);
    });

    return () => {
      cancelled = true;
    };
  }, [uriPair]);

  const diff = useMemo(() => {
    if (!beforeMetadata || !currentMetadata) return null;
    return diffPassportMetadata(beforeMetadata, currentMetadata);
  }, [beforeMetadata, currentMetadata]);

  if (!uriPair && !showReInspect) return null;

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-primary/80 p-4">
      {showReInspect && (
        <p className="text-sm font-medium text-accent-warm">
          Re-inspection recommended — verification was reset after a prior anchor change or dispute.
        </p>
      )}

      {!uriPair && (
        <p className="text-sm text-text-secondary">
          No metadata revision to compare yet.
        </p>
      )}

      {uriPair && !currentMetadata && (
        <p className="text-sm text-text-secondary">Current metadata unavailable for comparison.</p>
      )}

      {uriPair && loadError && (
        <p className="text-sm text-text-secondary">
          Previous metadata could not be loaded from {uriPair.beforeUri}.
        </p>
      )}

      {diff && (diff.anchor.length > 0 || diff.cosmetic.length > 0) ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Changes since the previous metadata URI:
          </p>
          <DiffList title="Anchor changes" changes={diff.anchor} variant="anchor" />
          <DiffList title="Cosmetic changes" changes={diff.cosmetic} variant="cosmetic" />
        </div>
      ) : null}

      {diff && diff.anchor.length === 0 && diff.cosmetic.length === 0 && (
        <p className="text-sm text-text-secondary">No field differences detected vs previous URI.</p>
      )}
    </div>
  );
}
