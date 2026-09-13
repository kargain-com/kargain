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
    owner:
      "hooks/use-tx-sync.ts · lib/web3/write-lifecycle.ts · lib/web3/evm-write-lifecycle.ts · lib/web3/svm-write-lifecycle.ts · lib/web3/write-outcome.ts",
    rule:
      "Post-truth invalidate + router.refresh only via syncReads / runTx; neutral write dispatch + barrier truth live in lib/web3 while the hook remains React orchestration only",
    guardTests: [
      "tx-sync-write-policy.test.ts",
      "evm-write-adapter-policy.test.ts",
      "s8-3-write-path.test.ts",
    ],
  },
  {
    id: "evm-write-adapter",
    owner: "lib/web3/evm-write-adapter.ts",
    rule: "wagmi useWriteContract / useSendTransaction only inside the EVM write adapter",
    guardTests: ["evm-write-adapter-policy.test.ts"],
  },
  {
    id: "svm-instruction-encoder",
    owner: "lib/svm/encode-instruction.ts · svm/crates/kargain-ix-wire",
    rule: "Commercial instruction data bytes only via encode-instruction; layout+goldens from Rust BorshSerialize (committed ix.manifest.json)",
    guardTests: ["svm-instruction-encoder-policy.test.ts"],
  },
  {
    id: "svm-pda-derivation",
    owner: "lib/svm/derive-pda.ts · svm/crates/kargain-ix-wire",
    rule: "Commercial SVM PDA: product entry deriveSvmPda = recipe id + COMMERCIAL_ACTIVE program only; layout seam deriveSvmPdaLayout = synthetic-only golden/plant path; product scanner bans seam imports; async kit only",
    guardTests: ["svm-pda-derivation-policy.test.ts"],
  },
  {
    id: "svm-write-adapter",
    owner:
      "lib/web3/svm-write-adapter.ts · lib/web3/svm-sign-and-send-port.ts · lib/web3/svm-rpc.ts · lib/web3/commercial-active.ts",
    rule: "SVM write: kit-assemble instruction + COMMERCIAL_ACTIVE program/chain + svm-rpc blockhash + solana:signAndSendTransaction port only (no signTransaction, no product submitter); base58 via kit decoder",
    guardTests: ["svm-write-adapter-policy.test.ts"],
  },
  {
    id: "passport-set-uri",
    owner:
      "lib/passport/set-passport-uri.ts · hooks/use-set-passport-uri.ts · lib/passport/prepare-passport-edit-write.ts · lib/svm/foreign-programs.ts · lib/svm/event-payload-decode.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM set passport URI: sole owner plans EVM setPassportURI / SVM SetPassportUri metas; edit panel admits via txWriteAvailability + TxWriteRefusal; EVM switch+SIWE via preparePassportEditWrite (SVM named none-required); panels call via useSetPassportUri + runTx; foreign program ids from Rust sibling manifest; tokenId↔bytes32 beside event-payload-decode",
    guardTests: ["set-passport-uri-policy.test.ts"],
  },
  {
    id: "svm-write-census",
    owner: "test/svm-write-census-policy.test.ts",
    rule: "Sole enumerated set of product write-site files under app|components|hooks (excludes use-tx-sync); human action matrix is local research annex only and never imported by tests",
    guardTests: ["svm-write-census-policy.test.ts"],
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
    owner: "lib/web3/keyed-multicall.ts · lib/web3/svm-keyed-read.ts",
    rule: "useReadContracts + SVM batch sibling only inside keyed-multicall; consumers use named keys",
    guardTests: ["keyed-multicall-policy.test.ts", "s8-3-write-path.test.ts"],
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
    rule: "Sole commercial-network set; isCommercialEip155Id ≠ isCommercialNamespace; injectable vm-filtered enumerators; eip155Of",
    guardTests: [
      "network-class-policy.test.ts",
      "commercial-enumerators-policy.test.ts",
      "commercial-active.test.ts",
      "commercial-active-svm-shape.test.ts",
    ],
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
      "scripts/lib/load-deployment.ts · scripts/lib/deployment-build-info.ts · scripts/lib/assert-deploy-evidence.ts · scripts/lib/assert-commercial-active-manifest.ts · scripts/lib/verify-from-deploy-evidence.ts · scripts/lib/etherscan-api.ts",
    rule: "Sole deployments/ path via deploymentsDirectory (+ KARGAIN_DEPLOYMENTS_DIR); build-info bound as {chainId}.build-info.json; verify:deploy-evidence refuses missing/drifted digests; COMMERCIAL_ACTIVE ≡ local manifest fail-closed (absence red); nuclear explorer verify submits standard-json from stored evidence (not Hardhat verify); tests must not rename/unlink repo manifests",
    guardTests: [
      "deployments-mutation-policy.test.ts",
      "deployment-build-info.test.ts",
      "assert-deploy-evidence.test.ts",
      "commercial-active-manifest-policy.test.ts",
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
    id: "svm-s5-passport-owner",
    owner: "scripts/svm-s5-init-and-prove.ts",
    rule: "S5 Devnet prove mints only to required --passport-owner durable pubkey; never Keypair.generate for mint owner (verifier may stay ephemeral)",
    guardTests: ["svm-s5-passport-owner-policy.test.ts"],
  },
  {
    id: "svm-binary-identity",
    owner: "scripts/lib/assert-svm-binary-identity.ts",
    rule: "Sole evidence soSha256 ↔ ProgramData leading ELF + empty padding; verify:svm-binary-identity; modes/source absence refuses by name; sibling of svm-upgrade-authority-evidence",
    guardTests: [
      "assert-svm-binary-identity.test.ts",
      "svm-binary-identity-policy.test.ts",
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
    id: "explorer-origin",
    owner: "lib/web3/explorer-origin.ts",
    rule: "Sole mintExplorerOrigin for commercial explorer bases; empty refused at registry ingress",
    guardTests: ["s8-1-consumer-wiring-policy.test.ts", "network-data-layer.test.ts"],
  },
  {
    id: "commercial-native-unit",
    owner: "lib/web3/commercial-native-unit.ts",
    rule: "Sole mintCommercialNativeUnit for stack nativeUnit; invalid symbol/decimals refused at ingress",
    guardTests: ["s8-1-consumer-wiring-policy.test.ts", "network-data-layer.test.ts"],
  },
  {
    id: "native-amount",
    owner: "lib/web3/native-amount.ts",
    rule: "Sole product parse/format of commercial native amounts; unit from CommercialNativeUnit; wallet-family ether helpers and literal eighteen confined here",
    guardTests: ["native-amount-policy.test.ts", "native-amount.test.ts"],
  },
  {
    id: "irys-upload-plan",
    owner: "lib/storage/irys-upload-plan.ts · lib/passport/upload-passport-metadata.ts",
    rule: "Sole Irys payment/bundler plan keyed by commercial namespace; product upload resolves stack via commercialNamespaceOf then getIrysUploaderForStack; no EIP-1193 dual wrappers; no wizard VM fork",
    guardTests: [
      "irys-upload-plan.test.ts",
      "irys-upload-session.test.ts",
      "native-amount-policy.test.ts",
    ],
  },
  {
    id: "irys-solana-adapter",
    owner:
      "adapters/irys-solana/build-uploader.ts · adapters/irys-solana/to-irys-provider.ts · lib/storage/irys-client.ts",
    rule: "Solana Irys SDK lives outside product roots and is reached only by one dynamic import from irys-client; Wallet Standard→Irys wrap stays in the adapter; EVM path does not fetch it",
    guardTests: ["irys-solana-adapter-policy.test.ts", "solana-web3-app-graph-policy.test.ts"],
  },
  {
    id: "product-policy-scan",
    owner: "test/policy-scan-helpers.ts",
    rule: "Sole product ownership-policy walk and static import reachability helper; policies supply predicate + owners only",
    guardTests: [
      "product-policy-scan-policy.test.ts",
      "network-explorer-owner-policy.test.ts",
      "network-vm-component-policy.test.ts",
      "passport-presence-owner-policy.test.ts",
      "s8-1-consumer-wiring-policy.test.ts",
      "active-account-owner-policy.test.ts",
      "solana-web3-app-graph-policy.test.ts",
      "irys-solana-adapter-policy.test.ts",
      "svm-wallet-adapter-policy.test.ts",
      "native-amount-policy.test.ts",
      "commercial-active-hub-literal-policy.test.ts",
    ],
  },
  {
    id: "policy-content-search",
    owner: "test/policy-content-search.ts",
    rule: "Sole content-search door for policy suites; never shell out to host rg (absent on GitHub Actions)",
    guardTests: ["policy-content-search-policy.test.ts"],
  },
  {
    id: "active-account",
    owner: "hooks/use-active-account.ts · lib/web3/active-account.ts · evm/svm adapters",
    rule: "Sole who-is-connected entry (discriminated account only); EVM facts via requireEvmSession / commercialNamespaceOf / switch availability (named causes); wagmi account hooks only in evm-account-adapter; no invented SVM namespace; no EVM-field undefined forks outside owners",
    guardTests: [
      "active-account-owner-policy.test.ts",
      "active-account.test.ts",
      "svm-wallet-adapter-policy.test.ts",
      "solana-web3-app-graph-policy.test.ts",
      "s8-5-named-unavailability-policy.test.ts",
    ],
  },
  {
    id: "network-explorer",
    owner: "lib/web3/network-explorer.ts",
    rule: "Sole commercial explorer address/tx URL owner; no viem explorer map or hub invent in product",
    guardTests: [
      "network-explorer-owner-policy.test.ts",
      "network-data-layer.test.ts",
      "passport-instrument-readouts-policy.test.ts",
      "s8-1-consumer-wiring-policy.test.ts",
    ],
  },
  {
    id: "network-vm-components",
    owner: "lib/web3/* network-class entry points",
    rule: "Product tree must not branch on commercial VM discriminant except allowlisted lib owners",
    guardTests: ["network-vm-component-policy.test.ts"],
  },
  {
    id: "chain-selector-state",
    owner: "lib/web3/chain-selector-state.ts",
    rule: "Commercial-namespace selector derive + picker enumeration; symmetric wrong_vm; EVM-only switch targets; no hub invent",
    guardTests: [
      "chain-selector-state.test.ts",
      "active-account.test.ts",
      "s8-5-named-unavailability-policy.test.ts",
      "commercial-active-hub-literal-policy.test.ts",
    ],
  },
  {
    id: "commercial-active-hub-literal",
    owner: "lib/web3/commercial-active.ts (registry) · parent-injected nativeUnit",
    rule: "app|components|hooks must not index COMMERCIAL_ACTIVE with a numeric literal (no hub invent)",
    guardTests: ["commercial-active-hub-literal-policy.test.ts"],
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
    id: "commercial-abi-events",
    owner: "lib/svm/commercial-abi-events.ts",
    rule: "Sole enumerator of the commercial ABI set (COMMERCIAL_CONTRACT_ABIS); assembling a parallel collection from abis.generated is banned except named owners (ponder.config = Ponder registration map)",
    guardTests: [
      "commercial-abi-events-policy.test.ts",
      "svm-event-disposition-policy.test.ts",
    ],
  },
  {
    id: "svm-program-events",
    owner: "lib/svm/commercial-abi-events.ts · svm/crates/kargain-events",
    rule: "Commercial ABI census via commercial-abi-events; structured SVM logs (D-28) encode + sol_log_data only via kargain-events",
    guardTests: [
      "commercial-abi-events-policy.test.ts",
      "svm-event-parity-policy.test.ts",
      "svm-event-disposition-policy.test.ts",
    ],
  },
  {
    id: "svm-raw-ingest",
    owner: "src/lib/svm-raw-writer.ts · src/svm-ingest/ · lib/svm/ingest-slot-discovery.ts",
    rule: "Append-only kargain_svm_raw writes only via svm-raw-writer; projection via svm-projection-writer; provenance reads via ponder-passport-provenance; slot discovery sole owner ingest-slot-discovery (signatures→slots; getBlock only those); RPC 429 sole owner rpc-client (disableRetryOnRateLimit + with429Backoff); live poll sole owner follow-loop (serial, no setInterval overlap)",
    guardTests: [
      "svm-raw-ingest-writer-policy.test.ts",
      "svm-raw-ingest-surface-policy.test.ts",
      "svm-projection-writer-policy.test.ts",
      "svm-metadata-snapshot-policy.test.ts",
      "svm-projection-passport-index-policy.test.ts",
      "svm-projection-digest-catalog-policy.test.ts",
      "svm-projection-replay-digest-pg.test.ts",
      "ponder-reindex-svm-isolation-policy.test.ts",
      "ponder-passport-provenance-policy.test.ts",
      "svm-ingest-loop.test.ts",
      "svm-ingest-follow-loop.test.ts",
      "svm-ingest-ready-surface.test.ts",
    ],
  },
  {
    id: "svm-projection-replay-digest",
    owner: "lib/svm/projection-replay-digest.ts · lib/svm/svm-projection-catalog.ts",
    rule: "Projection rebuild digest covers every kargain_svm_projection base table and every live column from the sole catalog selectSql; uncovered/absent column and undefined value types refuse by name; canonical keys are lexicographic; no subset-digest path",
    guardTests: [
      "svm-projection-digest-catalog-policy.test.ts",
      "svm-projection-replay-digest-pg.test.ts",
    ],
  },
  {
    id: "svm-commercial-program-census",
    owner: "lib/svm/ingest-config.ts",
    rule: "Six commercial program ids + blocks slots on COMMERCIAL_ACTIVE; assertSvmCommercialStack + follow set + min(blocks) cursor; mock_staking never followed; runtime never reaches scripts/lib/load-deployment",
    guardTests: ["svm-commercial-program-census-policy.test.ts"],
  },
  {
    id: "ponder-passport-provenance",
    owner: "src/lib/ponder-passport-provenance.ts",
    rule: "Chain-sharded passport_record / uri_history UNION reads only via provenance owner SQL",
    guardTests: ["ponder-passport-provenance-policy.test.ts"],
  },
  {
    id: "ponder-passport-entity",
    owner: "src/lib/ponder-passport-entity.ts",
    rule: "Chain-sharded passport entity UNION reads only via ponder-passport-entity owner SQL",
    guardTests: [
      "ponder-passport-entity-policy.test.ts",
      "ponder-passport-entity-union.test.ts",
      "ponder-kargain-physical-columns-policy.test.ts",
      "passport-entity-absence-policy.test.ts",
    ],
  },
  {
    id: "ponder-read-namespaces",
    owner: "src/lib/ponder-read-namespaces.ts",
    rule: "UNION ANY(...) namespaces from indexer owner; commercial-active has no process.env or localhost id",
    guardTests: ["ponder-read-namespaces.test.ts"],
  },
  {
    id: "passport-custody-fold",
    owner: "lib/custody/fold.ts",
    rule: "Two-stream custody fold is VM-agnostic; adapters outside fold; no cross-writer timestamp order",
    guardTests: [
      "custody-fold-policy.test.ts",
      "custody-fold.test.ts",
      "custody-fold-route-matrix.test.ts",
    ],
  },
  {
    id: "passport-presence-deriver",
    owner:
      "lib/passport/presence.ts · lib/passport/action-surface.ts · lib/passport/bridge-surface.ts · hooks/use-passport-presence.ts",
    rule: "derivePassportPresence only in named owners; components/routes consume answers",
    guardTests: [
      "passport-presence-owner-policy.test.ts",
      "passport-action-surface.test.ts",
    ],
  },
  {
    id: "ponder-passport-custody",
    owner: "src/lib/ponder-passport-custody.ts",
    rule: "HTTP custody load + fold only via ponder-passport-custody owner",
    guardTests: [
      "custody-fold-consumer-policy.test.ts",
      "custody-fold-policy.test.ts",
    ],
  },
  {
    id: "ponder-read-path-readiness",
    owner: "src/lib/ponder-read-path-ready.ts",
    rule: "Read-path readiness owns projection relation checks and executes the same empty-arm UNION query forms as product reads; declared↔served facts fail both directions",
    guardTests: ["ponder-read-path-ready.test.ts", "ponder-http-freshness-policy.test.ts"],
  },
  {
    id: "svm-ingest-ready-surface",
    owner: "src/svm-ingest/http-health.ts",
    rule: "svm-ingest /ready serves declared progress facts only; bootstrap_range_not_enumerated readable from the surface",
    guardTests: ["svm-ingest-ready-surface.test.ts"],
  },
  {
    id: "svm-devnet-evidence-write",
    owner: "scripts/lib/svm-devnet-evidence-write.ts",
    rule: "Sole additive writer for deployments/svm-{eid}.json; refuse drop / digest absence / deploySlot move",
    guardTests: ["svm-devnet-evidence-write-policy.test.ts"],
  },
  {
    id: "svm-startup-retention",
    owner: "lib/svm/startup-retention.ts",
    rule: "RPC retention of required ingest start slot is one predicate; ingest loop and upgrade dry-run consume it",
    guardTests: ["svm-startup-retention-policy.test.ts"],
  },
  {
    id: "svm-upgrade-in-place-capacity",
    owner: "scripts/lib/svm-upgrade-in-place-assert.ts",
    rule: "Upgradeable program-data capacity vs artifact size and payer vs solana-rent buffer cost refuse by name before any upgrade write; no auto-extend",
    guardTests: ["svm-upgrade-in-place-capacity-policy.test.ts"],
  },
  {
    id: "svm-program-extend-plan",
    owner: "scripts/lib/svm-program-extend-plan.ts",
    rule: "Founder-approved program-data extend ADDITIONAL_BYTES = ceil(artifact×5/4) − deployed; upgrade path never calls extend",
    guardTests: ["svm-program-extend-plan-policy.test.ts"],
  },
  {
    id: "svm-rpc-max-supported-transaction-version",
    owner:
      "lib/svm/rpc-max-supported-transaction-version.ts · lib/svm/rpc-block-transactions.ts · lib/svm/solana-json-rpc.ts",
    rule: "Sole maxSupportedTransactionVersion ceiling (1); ingest getBlock = JSON-RPC + wire mapper (never Connection.getBlock); product svm-rpc shares postSolanaJsonRpc",
    guardTests: [
      "svm-rpc-transaction-version-policy.test.ts",
      "svm-ingest-rpc-client-version.test.ts",
    ],
  },
  {
    id: "deploy-ponder-svm-ingest-ci",
    owner:
      ".github/workflows/ci.yml · .github/workflows/deploy-ponder.yml · .github/workflows/deploy-svm-ingest.yml · lib/architecture/ci-verify-partition.ts",
    rule: "Trunk CI (ci.yml) runs compile/typecheck/lint/test:ci/build; Install includes svm/lab frozen-lockfile (svm/tsconfig paths); deploy workflows needs: gates via workflow_call; test:ci = test:verify ∖ DEPLOY_MACHINE_VERIFY_SUITES (sole partition owner); Ponder never lists svm-ingest paths; svm-ingest never builds ponder; ponder deploy probes /ready and skips recreate on unchanged executable fingerprint",
    guardTests: [
      "deploy-ponder-svm-ingest-ci-policy.test.ts",
      "ensure-svm-lab-modules.test.ts",
    ],
  },
  {
    id: "ponder-deploy-identity",
    owner:
      "scripts/lib/ponder-identity-fingerprint.ts · scripts/lib/ponder-executable-fingerprint.ts · scripts/lib/ponder-readiness-probe.ts",
    rule: "Two fingerprints (identity = may need reindex; executable = must recreate) plus reserved /ready probe; neither equals Ponder build_id; scripts.test:* never recreates",
    guardTests: [
      "ponder-identity-fingerprint.test.ts",
      "ponder-executable-fingerprint.test.ts",
      "ponder-readiness-probe.test.ts",
      "deploy-ponder-svm-ingest-ci-policy.test.ts",
    ],
  },
  {
    id: "lib-scripts-boundary",
    owner: "lib/svm/devnet-evidence.ts · lib/** import graph",
    rule: "lib/ must not import scripts/; SVM deploy evidence types live in lib, loaders in scripts",
    guardTests: ["lib-scripts-boundary-policy.test.ts"],
  },
  {
    id: "typecheck-project-membership",
    owner: "lib/architecture/typecheck-projects.ts",
    rule: "Every TypeScript file is a root of exactly one typecheck project; typecheck runs all",
    guardTests: ["typecheck-project-membership-policy.test.ts"],
  },
  {
    id: "ponder-optional-contract-on",
    owner:
      "src/lib/ponder-optional-contract-on.ts · src/lib/ponder-optional-contract-events.ts",
    rule: "FixedPrice/Ascending/Gateway handlers register via onOptionalContractEvent; event name binds ABI args (ContractEventArgsFromTopics); no unbound eventArgs",
    guardTests: ["ponder-optional-contract-on-policy.test.ts"],
  },
] as const;

export const ARCHITECTURAL_CHOKEPOINT_IDS: readonly string[] =
  ARCHITECTURAL_CHOKEPOINTS.map((c) => c.id);
