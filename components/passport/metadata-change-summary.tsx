"use client";

import type {
  DisplayChange,
  MetadataDiffDisplay,
  PhotosDisplayChange,
  ScalarDisplayChange,
} from "@/lib/passport/format-metadata-diff-display";

type Props = {
  display: MetadataDiffDisplay;
  className?: string;
};

function ScalarChangeRow({ change }: { change: ScalarDisplayChange }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-text-primary">{change.label}</p>
      <div className="space-y-0.5 pl-0 text-sm text-text-secondary">
        <p>
          <span className="text-text-tertiary">Was </span>
          {change.before}
        </p>
        <p>
          <span className="text-text-tertiary">Now </span>
          {change.after}
        </p>
      </div>
    </div>
  );
}

function PhotoChangeRow({ change }: { change: PhotosDisplayChange }) {
  const { summary } = change;
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-primary">{change.label}</p>
      <p className="text-sm text-text-secondary">{summary.summaryLine}</p>
      {summary.addedThumbs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.addedThumbs.map((thumb, index) => (
            <div
              key={`${thumb.src}-${index}`}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border-default bg-bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb.src} alt={thumb.alt} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: DisplayChange }) {
  if (change.kind === "photos") {
    return <PhotoChangeRow change={change} />;
  }
  return <ScalarChangeRow change={change} />;
}

function ChangeSection({
  title,
  changes,
  variant,
}: {
  title: string;
  changes: DisplayChange[];
  variant: "identity" | "other";
}) {
  if (changes.length === 0) return null;

  const borderClass =
    variant === "identity" ? "border-status-error/30" : "border-border-default";

  return (
    <div className="space-y-2">
      <p
        className={
          variant === "identity"
            ? "text-sm font-medium text-status-error"
            : "text-sm font-medium text-text-primary"
        }
      >
        {title}
      </p>
      <ul className="space-y-3">
        {changes.map((change) => (
          <li
            key={change.field}
            className={`rounded-md border ${borderClass} p-3`}
          >
            <ChangeRow change={change} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MetadataChangeSummary({ display, className }: Props) {
  const { identityChanges, otherChanges } = display;

  if (identityChanges.length === 0 && otherChanges.length === 0) {
    return (
      <p className="text-sm text-text-secondary">No field differences detected.</p>
    );
  }

  return (
    <div className={`max-h-[min(70vh,28rem)] space-y-4 overflow-y-auto ${className ?? ""}`}>
      <ChangeSection
        title="Changes that affect verification"
        changes={identityChanges}
        variant="identity"
      />
      <ChangeSection title="Other updates" changes={otherChanges} variant="other" />
    </div>
  );
}
