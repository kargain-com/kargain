export const colors = {
  bgPrimary: "var(--color-bg-primary)",
  bgSurface: "var(--color-bg-surface)",
  bgCard: "var(--color-bg-card)",
  textPrimary: "var(--color-text-primary)",
  textSecondary: "var(--color-text-secondary)",
  textTertiary: "var(--color-text-tertiary)",
  borderDefault: "var(--color-border-default)",
  borderHover: "var(--color-border-hover)",
  accentWarm: "var(--color-accent-warm)",
  statusError: "var(--color-status-error)",
  statusWarning: "var(--color-status-warning)",
} as const;

export const typography = {
  fluidDisplay: "var(--text-fluid-display)",
  fluidH2: "var(--text-fluid-h2)",
  fluidBodyLg: "var(--text-fluid-body-lg)",
  fluidSm: "var(--text-fluid-sm)",
  h3: "var(--text-h3)",
} as const;

export const radii = {
  sm: "4px",
  md: "8px",
  full: "9999px",
} as const;

export const motion = {
  easeOutSmooth: [0.33, 1, 0.68, 1] as const,
  durationFast: 150,
  durationNormal: 250,
  durationSlow: 400,
} as const;
