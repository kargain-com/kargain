"use client";

import { useEffect, useMemo, useState } from "react";

import { MetadataChangeSummary } from "@/components/passport/metadata-change-summary";
import { EmptyState } from "@/components/ui/empty-state";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { fetchArweaveMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { formatMetadataDiffForDisplay } from "@/lib/passport/format-metadata-diff-display";
import {
  diffPassportMetadata,
  pickMetadataDiffUris,
  recommendsReInspection,
} from "@/lib/passport/metadata-diff";
import { resolveUri } from "@/lib/storage/resolve-uri";
import type { PonderUriHistoryEntry } from "@/lib/types/ponder";

type Props = {
  chainId: number;
  uriHistory: PonderUriHistoryEntry[];
  currentTokenUri: string;
  currentMetadata: PassportMetadata | null;
  verificationResetCount: number;
  lastVerificationResetAt: string;
};

export function MetadataDiffPanel({
  chainId,
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

    void fetchArweaveMetadata(uriPair.beforeUri, chainId).then((result) => {
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
  }, [uriPair, chainId]);

  const display = useMemo(() => {
    if (!beforeMetadata || !currentMetadata) return null;
    const diff = diffPassportMetadata(beforeMetadata, currentMetadata);
    return formatMetadataDiffForDisplay(diff, {
      photoContext: {
        resolveThumb: (uri, index) => ({
          src: resolveUri(uri, chainId),
          alt: `Photo ${index + 1}`,
        }),
      },
    });
  }, [beforeMetadata, currentMetadata, chainId]);

  if (!uriPair && !showReInspect) return null;

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-primary/80 p-4">
      {showReInspect && (
        <p className="text-sm font-medium text-accent-warm">
          Re-inspection recommended — verification was reset after a prior anchor change or dispute.
        </p>
      )}

      {!uriPair && (
        <EmptyState
          variant="content"
          level="B"
          title="No metadata revision to compare yet."
        />
      )}

      {uriPair && !currentMetadata && (
        <EmptyState
          variant="infrastructure"
          level="B"
          className="border-0 bg-transparent p-0 space-y-1"
          title="Current metadata unavailable for comparison."
        />
      )}

      {uriPair && loadError && (
        <EmptyState
          variant="infrastructure"
          level="B"
          role="alert"
          className="border-0 bg-transparent p-0 space-y-1"
          title="Previous metadata could not be loaded."
          description={uriPair.beforeUri}
        />
      )}

      {display && (display.identityChanges.length > 0 || display.otherChanges.length > 0) ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Changes since the previous metadata URI:
          </p>
          <MetadataChangeSummary display={display} />
        </div>
      ) : null}

      {display &&
        display.identityChanges.length === 0 &&
        display.otherChanges.length === 0 && (
          <EmptyState
            variant="content"
            level="B"
            title="No field differences detected vs previous URI."
          />
        )}
    </div>
  );
}
