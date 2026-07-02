/**
 * Canonical Tailwind class strings for Instrument Layer (design-spec §10.1–10.2).
 * Single source of truth — import here instead of duplicating prose in components.
 */

export const serialLabel =
  "font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary";

export const monoNumeric =
  "font-mono text-fluid-sm font-normal tabular-nums text-text-primary";

export const monoTimestamp =
  "font-mono tabular-nums text-text-secondary";

export const monoTimestampTertiary =
  "font-mono tabular-nums text-text-tertiary";

export const browsePrice =
  "font-mono text-lg font-medium tabular-nums text-text-primary";

export const feeLineCompact =
  "font-mono text-xs text-text-secondary";

export const feeLineDefault =
  "font-mono text-sm text-text-secondary";

const linkFocus =
  "transition-colors duration-200 hover:text-accent-warm focus-visible:text-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

export const monoLink = `font-mono text-text-secondary ${linkFocus}`;

export const monoLinkSm = `font-mono text-xs text-text-secondary ${linkFocus}`;

export const sansLink = `font-sans text-sm text-text-secondary ${linkFocus}`;

export const sansLinkUnderline = `${sansLink} underline underline-offset-4`;

/** Narrative page/section eyebrow — matches global `.eyebrow` (§3). */
export const narrativeEyebrow =
  "font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm";

/** KarPro broker type, verifier category — same as serialLabel (§10.2). */
export const categoryLabel = serialLabel;

/** EmptyState action + profile external CTA (§12.3.1 exception). */
export const ctaLink =
  "inline-flex min-h-11 items-center text-sm text-accent-warm transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

/** Bordered shell controls — no accent hover border (§10.6). */
export const shellControlHover =
  "hover:border-border-hover hover:text-text-primary";

/** L-shaped corner stroke for InstrumentFrame (§12.4). */
export const instrumentFrameCorner =
  "pointer-events-none absolute block size-3 border-border-default";

export const instrumentFrameCornerVerified =
  "pointer-events-none absolute block size-3 border-accent-warm/40";

/** Registration stamp base — squared trust badges (§12.4). */
export const trustStampBase =
  "inline-flex items-center gap-1.5 rounded-sm border bg-bg-surface px-2.5 py-1 font-mono text-xs font-medium tracking-[0.18em] uppercase";

export const trustStampVerified = "border-accent-warm text-accent-warm";

export const trustStampDisputed = "border-status-error text-status-error";

export const trustStampNeutral = "border-border-default text-text-secondary";

export const trustStampKarPro = "border-accent-warm/40 text-accent-warm";

/** Post-confirmation commerce stamp (§12.7). */
export const trustStampSuccess = "border-status-success text-status-success";

/** Level B shell for purchase / external payment confirmed (§12.7). */
export const commerceConfirmedPanel =
  "rounded-md border border-status-success/40 bg-bg-primary/80 p-4";

/** Mono eyebrow for commerce-confirmed readouts (§12.7). */
export const commerceConfirmedLabel =
  "font-mono text-xs font-medium tracking-[0.18em] uppercase text-status-success";

/** Section anchors below sticky top nav; extra offset on mobile for bottom FAB (§13.1). */
export const sectionScrollAnchor = "scroll-mt-28 md:scroll-mt-24";

/** Level B instrument readouts shell on passport detail (§12.6). */
export const instrumentReadoutPanel =
  "rounded-md border border-border-default bg-bg-surface p-4";

const profileTabBase =
  "min-h-11 border-b-2 -mb-px px-4 py-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

/** Profile tab active — accent bottom border only (§12.6). */
export const profileTabActive = `${profileTabBase} border-accent-warm text-text-primary`;

/** Profile tab inactive. */
export const profileTabInactive = `${profileTabBase} border-transparent text-text-secondary hover:text-text-primary`;

export const instrumentClasses = {
  serialLabel,
  monoNumeric,
  monoTimestamp,
  monoTimestampTertiary,
  browsePrice,
  feeLineCompact,
  feeLineDefault,
  monoLink,
  monoLinkSm,
  sansLink,
  sansLinkUnderline,
  narrativeEyebrow,
  categoryLabel,
  ctaLink,
  shellControlHover,
  instrumentFrameCorner,
  instrumentFrameCornerVerified,
  trustStampBase,
  trustStampVerified,
  trustStampDisputed,
  trustStampNeutral,
  trustStampKarPro,
  trustStampSuccess,
  commerceConfirmedPanel,
  commerceConfirmedLabel,
  sectionScrollAnchor,
  instrumentReadoutPanel,
  profileTabActive,
  profileTabInactive,
} as const;
