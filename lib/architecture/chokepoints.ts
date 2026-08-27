/**
 * Architectural choke-points — sole owners + guarding tests.
 *
 * Canonical in-repo list (Cursor cannot read the system prompt). Maintainer
 * prose: docs/REFERENCE.md § Architectural choke-points. Enforcement idiom:
 * docs/WORKING-METHOD.md §6. Meta-test: test/architectural-enforcement-meta.test.ts.
 *
 * A choke-point is a module (or small set) that owns one rule; consumers must
 * not re-implement or bypass it. Every entry names ≥1 guarding test that is
 * reachable from a targeted `test:*` gate (or the Hardhat runner for
 * hardhat-native suites).
 */

export type ArchitecturalChokepoint = {
  /** Stable id — do not reuse forms from other axes (e.g. Truth T1–T6). */
  id: string;
  /** Owning module path(s) from repo root. */
  owner: string;
  /** One-line rule the owner enforces. */
  rule: string;
  /** Guarding test files under `test/` (basename). */
  guardTests: readonly string[];
};

export const ARCHITECTURAL_CHOKEPOINTS: readonly ArchitecturalChokepoint[] = [
  {
    id: "tx-sync-writes",
    owner: "hooks/use-tx-sync.ts",
    rule: "Post-truth invalidate + router.refresh only via syncReads / runTx",
    guardTests: ["tx-sync-write-policy.test.ts"],
  },
  {
    id: "ponder-tagged-read",
    owner: "lib/web3/ponder-tagged-read.ts",
    rule: "Mutable Ponder projections read only through tagged use cache (T3)",
    guardTests: ["ponder-fetch-policy.test.ts", "ponder-fetch.test.ts"],
  },
  {
    id: "ponder-route-catalog",
    owner: "lib/web3/ponder-endpoints.ts · lib/web3/ponder-client.ts",
    rule: "Product Ponder HTTP URLs/parse only via typed catalog/client",
    guardTests: ["ponder-contract-route-policy.test.ts"],
  },
  {
    id: "ponder-http-freshness",
    owner: "src/lib/ponder-http-freshness.ts · src/lib/ponder-http-cache-middleware.ts",
    rule: "Every Hono GET has exactly one freshness class (indexer→edge)",
    guardTests: ["ponder-http-freshness-policy.test.ts"],
  },
  {
    id: "indexer-query-keys",
    owner: "lib/web3/indexer-query-keys.ts · app/actions/revalidate-indexer-cache.ts",
    rule: "RQ prefixes + updateTag cover the same INDEXER_QUERY_KEY_PREFIXES set",
    guardTests: ["indexer-query-key-coverage.test.ts"],
  },
  {
    id: "keyed-multicall",
    owner: "lib/web3/keyed-multicall.ts",
    rule: "useReadContracts only inside keyed-multicall; consumers use named keys",
    guardTests: ["keyed-multicall-policy.test.ts"],
  },
  {
    id: "passport-approval",
    owner: "hooks/use-passport-approval.ts",
    rule: "ERC-721 passport approve for any spender has one owner",
    guardTests: ["passport-approval-policy.test.ts"],
  },
  {
    id: "server-actions-export",
    owner: "app/actions/* (async only) · lib/ for parse/types",
    rule: "use server modules export only async Server Actions",
    guardTests: ["server-actions-export-policy.test.ts"],
  },
  {
    id: "provider-scope",
    owner: "lib/providers/provider-scope.ts",
    rule: "Identity providers mount only under (identity); public has no badges",
    guardTests: ["provider-scope-policy.test.ts"],
  },
  {
    id: "content-image",
    owner: "components/media/content-image.tsx",
    rule: "Content photos render only through ContentImage / next/image config",
    guardTests: ["content-image-policy.test.ts"],
  },
  {
    id: "personal-sign-identity",
    owner: "lib/web3/wallet-account.ts",
    rule: "supportsPersonalSignIdentity is the sole personal-sign identity predicate",
    guardTests: ["personal-sign-identity-policy.test.ts"],
  },
  {
    id: "nostr-query-sync-writes",
    owner: "lib/nostr/app-event-store.ts · favorites · profile · notification-state",
    rule: "LWW/RMW writers do not use querySync; coverage owns publish allowlist",
    guardTests: ["nostr-query-sync-write-policy.test.ts"],
  },
  {
    id: "messaging-storage",
    owner: "lib/messaging/adapters/cache-adapter.ts",
    rule: "Browser storage under messaging namespace has one owner",
    guardTests: ["messaging-invariant-storage.test.ts"],
  },
  {
    id: "messaging-session-contract",
    owner: "lib/messaging/machine.ts · snapshot-ui.ts · session-registry.ts",
    rule: "Session lifecycle, mint, consent, delivery invariants I1–I20",
    guardTests: [
      "messaging-invariant-sdk-load.test.ts",
      "messaging-invariant-mint.test.ts",
      "messaging-invariant-lifecycle.test.ts",
      "messaging-invariant-session.test.ts",
      "messaging-invariant-delivery.test.ts",
      "messaging-invariant-consent.test.ts",
      "messaging-export-policy.test.ts",
    ],
  },
  {
    id: "passport-browse-indexes",
    owner: "src/lib/passport-browse-index-contract.ts · ponder.schema.ts",
    rule: "Passport indexes ↔ browse predicates are bidirectional",
    guardTests: ["passport-browse-index-policy.test.ts"],
  },
  {
    id: "marketplace-browse-filters",
    owner:
      "lib/marketplace/consignment-browse-filters.ts · src/lib/ponder-consignment-browse.ts · components/marketplace/filter-combobox.tsx · lib/commerce/listing-price-display.ts",
    rule:
      "Browse filters apply: chrome commits URL state; keys ⊆ catalog ⊆ handler; price/sort USD ≡ Asking facts",
    guardTests: ["marketplace-browse-filter-invariant.test.ts"],
  },
  {
    id: "challenges-browse-filters",
    owner:
      "lib/challenge/browse-filters.ts · app/actions/commerce-challenges.ts · src/api/commerce-routes.ts · components/challenges/challenges-client.tsx",
    rule:
      "Challenges chrome chips → one query owner; unresolved ≡ isChallengeUnresolved; totals share SQL predicates; no client re-filter",
    guardTests: ["challenges-browse-filter-invariant.test.ts"],
  },
  {
    id: "custom-error-coverage",
    owner: "contracts ABIs · Hardhat suites · lib/marketplace/tx-error-message.ts",
    rule: "Declared custom errors have revertsWith; UI names money-path outcomes",
    guardTests: [
      "error-coverage-policy.test.ts",
      "error-name-truth-policy.test.ts",
      "tx-error-message-coverage.test.ts",
    ],
  },
  {
    id: "eip170-contract-size",
    owner: "contracts/* (production)",
    rule: "Production contracts stay under EIP-170 24_576 bytes",
    guardTests: ["contract-size.test.ts"],
  },
  {
    id: "kar-pro-metadata-upload",
    owner: "lib/kar-pro/upload-kar-pro-metadata.ts",
    rule: "Pure KarPro metadata must not import Irys; upload owns the SDK",
    guardTests: ["kar-pro-metadata-upload-policy.test.ts"],
  },
  {
    id: "smoke-bridge-mainnet-gate",
    owner: "scripts/smoke-bridge (assertSmokeBridgeAllowed)",
    rule: "Smoke bridge refuses commercial mainnet chain ids",
    guardTests: ["smoke-bridge-policy.test.ts"],
  },
  {
    id: "photo-drop-zone",
    owner: "components/ui/photo-drop-zone (layout contract)",
    rule: "Empty Photos section must not cram Label+Button on one line",
    guardTests: ["photo-drop-zone-policy.test.ts"],
  },
  {
    id: "peer-identity-kar-pro",
    owner: "hooks/use-peer-identity.ts · lib/kar-pro/membership-roster.ts",
    rule: "KarPro anyActive has one owner; no address-OR loops",
    guardTests: ["peer-identity-policy.test.ts"],
  },
  {
    id: "live-policy-subscription",
    owner: "lib/nostr/live-policy-subscription.ts",
    rule: "Latest-per-author-per-d live subscribe merge/teardown owned here",
    guardTests: ["live-policy-subscription.test.ts"],
  },
  {
    id: "commercial-stack-registry",
    owner: "lib/web3/commercial-active.ts · lib/web3/kargain-namespace.ts",
    rule: "Sole commercial-network set / isCommercialChainId; vm-tagged registry; eip155Of",
    guardTests: ["network-class-policy.test.ts"],
  },
  {
    id: "declared-weights",
    owner: "lib/web3/declared-weights.ts",
    rule: "SPEC §13.10 wei literals (stake/bonds) live only in declared-weights",
    guardTests: ["network-class-policy.test.ts"],
  },
  {
    id: "protocol-address-compare",
    owner: "lib/web3/protocol-address.ts",
    rule: "Protocol address normalize/compare by namespace; no dual toLowerCase match",
    guardTests: ["network-class-policy.test.ts"],
  },
] as const;

export const ARCHITECTURAL_CHOKEPOINT_IDS: readonly string[] =
  ARCHITECTURAL_CHOKEPOINTS.map((c) => c.id);
