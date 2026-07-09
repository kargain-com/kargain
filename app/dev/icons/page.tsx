import { notFound } from "next/navigation";

import * as Icons from "@/components/ui/icons";

const SIZES = [16, 20, 24] as const;

const ICON_ENTRIES = Object.entries(Icons)
  .filter(
    ([name, value]) =>
      typeof value === "function" &&
      name.endsWith("Icon") &&
      name !== "SpinnerIcon",
  )
  .sort(([a], [b]) => a.localeCompare(b));

export default function DevIconsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="container py-8">
      <h1 className="font-display text-fluid-h2 text-text-primary">Icon review</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Mono Icons generated module plus Kargain extension glyphs. Temporary route for M-ICON batch 1/4.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ICON_ENTRIES.map(([name, Icon]) => (
          <div
            key={name}
            className="rounded-md border border-border-default bg-bg-surface p-4"
          >
            <div className="flex items-end justify-around gap-3 text-text-primary">
              {SIZES.map((size) => (
                <div key={size} className="flex flex-col items-center gap-2">
                  <Icon size={size} />
                  <span className="font-mono text-xs text-text-tertiary tabular-nums">{size}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 font-mono text-xs text-text-secondary">{name}</p>
            {name === "RefreshIcon" ? (
              <p className="mt-1 text-xs text-text-tertiary">alias: SpinnerIcon</p>
            ) : null}
          </div>
        ))}
      </div>
    </main>
  );
}
