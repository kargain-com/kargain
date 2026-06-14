import type { PonderUriHistoryEntry } from "@/lib/types/ponder";
import { navShortAddress } from "@/lib/web3/wallet-display";

type Props = {
  entries: PonderUriHistoryEntry[];
};

function formatDate(timestampSec: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

export function PassportUriHistory({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
      <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
        Metadata history
      </h2>
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`rounded-md border p-4 ${
              entry.verificationReset
                ? "border-status-error/40 bg-bg-primary/80"
                : "border-border-default bg-bg-primary/80"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-tertiary">
                {formatDate(entry.timestamp) || "Unknown date"}
              </p>
              {entry.verificationReset && (
                <span className="text-xs font-medium text-status-error">
                  Verification reset
                </span>
              )}
            </div>
            <p className="mt-2 font-sans text-xs text-text-secondary">
              Author: {navShortAddress(entry.author as `0x${string}`)}
            </p>
            <p className="mt-2 break-all font-mono text-xs text-text-primary">
              {entry.newUri}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
