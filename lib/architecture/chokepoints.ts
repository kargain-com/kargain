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
    owner: "contracts ABIs · Hardhat suites · lib/marketplace/tx-error-message.ts · svm/crates/kargain-errors",
    rule: "Declared custom errors have revertsWith; Rust KargainError names mirror Solidity (SVM-only allowlist); UI names money-path outcomes",
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
    id: "on-chain-bytecode-identity",
    owner: "scripts/lib/on-chain-bytecode-identity.ts",
    rule: "Sole eth_getCode vs immutable-filled artifact body compare; verify:bytecode-identity",
    guardTests: ["on-chain-bytecode-identity.test.ts"],
  },
  {
    id: "deployments-directory",
    owner:
      "scripts/lib/load-deployment.ts · scripts/lib/deployment-build-info.ts · scripts/lib/assert-deploy-evidence.ts · scripts/lib/verify-from-deploy-evidence.ts · scripts/lib/etherscan-api.ts",
    rule: "Sole deployments/ path via deploymentsDirectory (+ KARGAIN_DEPLOYMENTS_DIR); build-info bound as {chainId}.build-info.json; verify:deploy-evidence refuses missing/drifted digests; nuclear explorer verify submits standard-json from stored evidence (not Hardhat verify); tests must not rename/unlink repo manifests",
    guardTests: [
      "deployments-mutation-policy.test.ts",
      "deployment-build-info.test.ts",
      "assert-deploy-evidence.test.ts",
      "verify-from-deploy-evidence.test.ts",
    ],
  },
  {
    id: "svm-upgrade-authority-evidence",
    owner: "scripts/lib/assert-svm-upgrade-authority.ts",
    rule: "Sole live svm-{eid} programs.*.upgradeAuthority ↔ on-chain ProgramData Authority; verify:svm-authority; no plannedFinalUpgradeAuthority knob",
    guardTests: [
      "assert-svm-upgrade-authority.test.ts",
      "svm-upgrade-authority-policy.test.ts",
    ],
  },
  {
    id: "declared-weights",
    owner: "lib/web3/declared-weights.ts",
    rule: "SPEC §13.10 wei literals (stake/bonds) live only in declared-weights",
    guardTests: ["network-class-policy.test.ts"],
  },
  {
    id: "declared-uri-ceiling",
    owner:
      "lib/web3/declared-uri-ceiling.ts · contracts/lib/PassportUriCeiling.sol · svm/crates/kargain-errors",
    rule: "SPEC §I.13 passport URI ceiling bytes — one literal, three language mirrors",
    guardTests: ["declared-uri-ceiling-policy.test.ts"],
  },
  {
    id: "protocol-address-compare",
    owner: "lib/web3/protocol-address.ts",
    rule: "Protocol address normalize/compare by namespace; no dual toLowerCase match",
    guardTests: ["network-class-policy.test.ts"],
  },
  {
    id: "bridge-route-resolver",
    owner: "lib/web3/bridge/bridge-config.ts",
    rule: "resolveBridgeRoute owns hub/spoke hops; no second counterpart map under lib/hooks/components",
    guardTests: ["bridge-route-policy.test.ts"],
  },
  {
    id: "layerzero-eid-namespace",
    owner: "lib/web3/commercial-eid-namespace.ts",
    rule: "LayerZero EID → commercial namespace only via commercialNamespaceFromLayerZeroEid; unknown EID fails closed",
    guardTests: ["kargain-namespace-eid.test.ts"],
  },
  {
    id: "bridge-crossing-stream",
    owner:
      "src/bridge-handlers.ts · src/lib/ponder-bridge-crossings.ts · lib/bridge/crossing-stream.ts",
    rule: "Append-only bridge_crossing rows written only by gateway handlers + correlation owner; no HTTP consumer in S7b",
    guardTests: [
      "ponder-bridge-crossings.test.ts",
      "ponder-gateway-index-policy.test.ts",
      "ponder-bridge-crossing-surface-policy.test.ts",
    ],
  },
  {
    id: "svm-money-model",
    owner:
      "svm/crates/kargain-claimable-payouts · svm/crates/kargain-bonded-challenge · svm/crates/kargain-agented-split",
    rule: "SPL claim PDAs + per-subject bond PDAs; no push_ok/transfer_ok; no global pending maps; S32 split one Rust owner",
    guardTests: ["svm-money-model-policy.test.ts"],
  },
  {
    id: "svm-consignment-automaton",
    owner: "svm/crates/kargain-consignment-base",
    rule: "Shared Mandate+Recall+ConsignmentBase transitions; require_can_open order; custody=owner move; split via agented-split; payout via claimable-payouts; validator surfaces: consignment-harness (automaton) + kar-fixed-price (mode)",
    guardTests: ["svm-consignment-automaton-policy.test.ts"],
  },
  {
    id: "svm-fixed-price-price-owner",
    owner: "svm/crates/kargain-price + svm/programs/kar-fixed-price",
    rule: "FixedPrice fiat/oracle only via kargain-price (PriceUpdateV2_msg@41); admit pins feed; buy refuses stale/wide/bad by name; Ascending stays oracle-banned; ApprovePaymentToken proves mint; SPL buy measures delivery; ForceSeedPriceAccount authority-gated for LIVE",
    guardTests: ["svm-fixed-price-price-owner-policy.test.ts"],
  },
  {
    id: "svm-ascending-asset-only",
    owner: "svm/programs/kar-ascending",
    rule: "Ascending asset-only — no oracle/quote; OpenDirect→AscendingOpenPath; Bid+FixedPrice Buy share require_full_delivery owner; VERIFIED+active-verifier at open; settle moves no money",
    guardTests: ["svm-ascending-asset-only-policy.test.ts"],
  },
  {
    id: "svm-stand-live-proof",
    owner: "svm/stand/live-*.ts (proof runners imported by test/svm-stand.test.ts)",
    rule: "LIVE proof return values for the outer suite must be chain observations — not PHASE/ERR catalogs, literals, or Keypair/PDA toBase58 in the return object",
    guardTests: ["svm-stand-live-proof-return-policy.test.ts"],
  },
  {
    id: "svm-stand-artifact-bindings",
    owner: "svm/stand/stand-artifact-bindings.ts",
    rule: "LIVE stand proofs attest sha256 of every preloaded .so + git HEAD via withStandArtifactBindings; sole deploy .so hasher under svm/stand",
    guardTests: ["svm-stand-artifact-bindings-policy.test.ts"],
  },
  {
    id: "svm-program-events",
    owner: "svm/crates/kargain-events",
    rule: "Structured SVM program logs (D-28) encode + sol_log_data only via kargain-events; parity with handler census",
    guardTests: ["svm-event-parity-policy.test.ts"],
  },
  {
    id: "svm-raw-ingest",
    owner: "src/lib/svm-raw-writer.ts · src/svm-ingest/",
    rule: "Append-only kargain_svm_raw writes only via svm-raw-writer; no product HTTP consumer in S7c-1",
    guardTests: [
      "svm-raw-ingest-writer-policy.test.ts",
      "svm-raw-ingest-surface-policy.test.ts",
      "ponder-reindex-svm-isolation-policy.test.ts",
    ],
  },
  {
    id: "lib-scripts-boundary",
    owner: "lib/svm/devnet-evidence.ts · lib/** import graph",
    rule: "lib/ must not import scripts/; SVM deploy evidence types live in lib, loaders in scripts",
    guardTests: ["lib-scripts-boundary-policy.test.ts"],
  },
] as const;

export const ARCHITECTURAL_CHOKEPOINT_IDS: readonly string[] =
  ARCHITECTURAL_CHOKEPOINTS.map((c) => c.id);
