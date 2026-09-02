/**
 * Branded commercial block-explorer origin (S8-1-close).
 * Mint at registry ingress only — same shape as {@link KargainNamespace}.
 */

declare const explorerOriginBrand: unique symbol;

export type ExplorerOrigin = string & {
  readonly [explorerOriginBrand]: void;
};

/** Mint an explorer origin — registry / fixture ingress only. */
export function mintExplorerOrigin(value: string): ExplorerOrigin {
  const trimmed = value.trim().replace(/\/$/, "");
  if (trimmed.length === 0) {
    throw new Error(`Invalid ExplorerOrigin: empty`);
  }
  return trimmed as ExplorerOrigin;
}
