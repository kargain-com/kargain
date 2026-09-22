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
  /**
   * Owning module description. When {@link ownerFiles} is set, this is prose only
   * (no path-like tokens) — paths live solely in ownerFiles.
   */
  owner: string;
  /**
   * Optional: product files that define census primitives (S8-D0). Only mechanism
   * choke-points. Exclusion set for the census = union of all ownerFiles.
   */
  ownerFiles?: readonly string[];
  /** One-line rule the owner enforces. */
  rule: string;
  /** Guarding test files under `test/` (basename). */
  guardTests: readonly string[];
};

export const ARCHITECTURAL_CHOKEPOINTS: readonly ArchitecturalChokepoint[] = [
  {
    id: "tx-sync-writes",
    owner:
      "Post-truth write sync: React hook orchestrates; lifecycle modules hold barrier truth",
    ownerFiles: ["hooks/use-tx-sync.ts"],
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
    owner: "Sole product door for wagmi writeContract and sendTransaction hooks",
    ownerFiles: ["lib/web3/evm-write-adapter.ts"],
    rule: "wagmi useWriteContract / useSendTransaction only inside the EVM write adapter",
    guardTests: ["evm-write-adapter-policy.test.ts"],
  },
  {
    id: "svm-instruction-encoder",
    owner: "lib/svm/encode-instruction.ts · svm/crates/kargain-ix-wire",
    rule: "Commercial instruction data bytes only via encode-instruction; layout+goldens from Rust BorshSerialize (committed ix.manifest.json); append-only vs published-trunk baseline (not HEAD)",
    guardTests: [
      "svm-instruction-encoder-policy.test.ts",
      "ix-append-only-baseline-policy.test.ts",
    ],
  },
  {
    id: "ix-append-only-baseline",
    owner: "lib/architecture/ix-append-only-baseline.ts",
    rule: "Commercial ix-manifest append-only baseline = published trunk: Actions = push before / PR base.sha only (refuse baseline_ci_event_unresolved / baseline_is_head); local else merge-base HEAD origin/master; missing baseline or manifest refuses by name (never skip)",
    guardTests: ["ix-append-only-baseline-policy.test.ts"],
  },
  {
    id: "svm-pda-derivation",
    owner: "lib/svm/derive-pda.ts · svm/crates/kargain-ix-wire",
    rule: "Commercial SVM PDA: product entry deriveSvmPda = recipe id + COMMERCIAL_ACTIVE program only; layout seam deriveSvmPdaLayout = synthetic-only golden/plant path; product scanner bans seam imports; async kit only",
    guardTests: ["svm-pda-derivation-policy.test.ts"],
  },
  {
    id: "svm-account-state-decode",
    owner: "lib/svm/decode-account-state.ts · svm/crates/kargain-ix-wire",
    rule: "Commercial SVM account-state decode (PassportState + StakeAccount + ChallengeAccount + partial PassportConfig) only via decode-account-state; layout+goldens from Rust BorshSerialize (committed state.manifest.json); cursor decode; u128; remainder_unmodelled terminal (not padding); ChallengeAccount fully-consumed meaningful; PassportConfig deliberately partial (populated-vec golden); product surfaces base58 via encodeSvmPubkeyBytes; no hand offsets; no chrome amounts from StakeAccount",
    guardTests: ["svm-account-state-decode-policy.test.ts"],
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
    id: "passport-append-record",
    owner:
      "lib/passport/append-passport-record.ts · hooks/use-append-passport-record.ts · lib/passport/prepare-passport-record-write.ts · lib/svm/decode-account-state.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM AppendRecord: sole owner plans EVM appendRecord / SVM AppendRecord with fresh PassportState read → record PDA at recordCount; seven metas processor order; prep names EVM SIWE on evidence file vs SVM/paste none-required; panel migrates append+clarification only via txWriteAvailability + TxWriteRefusal; action-surface gates unchanged",
    guardTests: ["append-passport-record-policy.test.ts"],
  },
  {
    id: "passport-report-discrepancy",
    owner:
      "lib/passport/report-passport-discrepancy.ts · hooks/use-report-passport-discrepancy.ts · lib/passport/prepare-passport-record-write.ts · lib/svm/decode-account-state.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM ReportDiscrepancy: sole owner plans EVM reportDiscrepancy (three args) / SVM ReportDiscrepancy with fresh PassportState read → record PDA at recordCount; seven metas processor order with reporter signer + asset READONLY; no shared assembler with AppendRecord; panel migrates via txWriteAvailability + TxWriteRefusal; action-surface holder withhold unchanged",
    guardTests: ["report-passport-discrepancy-policy.test.ts"],
  },
  {
    id: "passport-append-attestation",
    owner:
      "lib/passport/append-passport-attestation.ts · hooks/use-append-passport-attestation.ts · lib/passport/prepare-passport-record-write.ts · lib/svm/decode-account-state.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM AppendAttestation: sole owner plans EVM appendAttestation (three args) / SVM AppendAttestation with fresh PassportState read → record PDA at recordCount + stake PDA derive-only; eight metas processor order; asset READONLY; no shared assembler with AppendRecord/ReportDiscrepancy; panel migrates via txWriteAvailability + TxWriteRefusal",
    guardTests: ["append-passport-attestation-policy.test.ts"],
  },
  {
    id: "passport-verify",
    owner:
      "lib/passport/verify-passport.ts · hooks/use-verify-passport.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM VerifyPassport: sole owner plans EVM verifyPassport (one arg) / SVM VerifyPassport with five metas (config, asset, state, stake, verifier) derive-only — no PassportState freshness, no stake-data decode; no shared assembler with record-writing owners; panel migrates verify via txWriteAvailability + TxWriteRefusal; challenge family (open/withdraw/judge/conclude) also migrated",
    guardTests: ["verify-passport-policy.test.ts"],
  },
  {
    id: "passport-open-challenge",
    owner:
      "lib/passport/open-challenge.ts · lib/passport/challenge-bond-disclosure.ts · hooks/use-open-challenge.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM OpenChallenge: sole owner plans EVM open+[tid]+value / SVM OpenChallenge seven metas derive-only (challenger=payer one wallet); bond disclosure answers amountSource/requiresAmountKnownBeforeSubmit/deliverySentence without VM identity; SVM amount readable via PassportConfig keyed decode (no named-unread); SVM delivery must not promise Claims; panel migrates open (withdraw/judge/conclude also migrated)",
    guardTests: ["open-challenge-policy.test.ts"],
  },
  {
    id: "passport-withdraw-challenge",
    owner:
      "lib/passport/withdraw-challenge.ts · lib/passport/challenge-bond-disclosure.ts · hooks/use-withdraw-challenge.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM WithdrawChallenge: sole owner plans EVM withdraw+[tid] (no value) / SVM WithdrawChallenge eight metas with fresh PassportState→record PDA at recordCount (challenger=payer); undeliverableBondOutcome claimPossible true+Claims copy on EVM / false on SVM; panel migrates withdraw via writeAvail+bondDisclosure.configured (challenge family complete)",
    guardTests: ["withdraw-challenge-policy.test.ts"],
  },
  {
    id: "passport-judge-challenge",
    owner:
      "lib/passport/judge-challenge.ts · hooks/use-judge-challenge.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM JudgeChallenge: sole owner plans EVM judge+[tid,outcome 0|1] (no value) / SVM JudgeChallenge nine metas with chain-resolved bond_recipient (Upheld→challenger decode, Rejected→forfeit decode — one arm); stake derive-only no decodeStakeAccount; unresolved recipient refuses by name; panel migrates judge via writeAvail+bondDisclosure.configured (challenge family complete)",
    guardTests: ["judge-challenge-policy.test.ts"],
  },
  {
    id: "passport-conclude-challenge",
    owner:
      "lib/passport/conclude-challenge.ts · hooks/use-conclude-challenge.ts · components/shell/tx-write-refusal.tsx",
    rule: "Dual-VM ConcludeChallenge: sole owner plans EVM conclude+[tid] (no value) / SVM ConcludeChallenge six metas with forfeit-only bond_recipient from PassportConfig decode; permissionless (payer READONLY_SIGNER only — no judge/stake); unresolved recipient refuses by name; panel migrates conclude via writeAvail+bondDisclosure.configured; legacy panel run helper deleted",
    guardTests: ["conclude-challenge-policy.test.ts"],
  },
  {
    id: "active-verifier-fact",
    owner:
      "lib/verifier/active-verifier-fact.ts · hooks/use-active-verifier-fact.ts · lib/svm/decode-account-state.ts",
    rule: "Dual-VM active-verifier admission fact: EVM isActiveVerifier read; SVM stake PDA keyed-read + StakeAccount.active only; tri-state active|inactive|unresolved mapped to boolean|undefined for action-surface/obligations; never collapse unresolved to false",
    guardTests: ["active-verifier-fact-policy.test.ts"],
  },
  {
    id: "kar-pro-set-verification-fee",
    owner:
      "lib/verifier/set-verification-fee.ts · lib/verifier/verification-fee-composition.ts · lib/verifier/verification-fee-surface.ts · hooks/use-set-verification-fee.ts · lib/kar-pro/kar-pro-hub-admit.ts",
    rule: "Dual-VM KarPro setVerificationFee: sole owner plans EVM setVerificationFee / SVM SetVerificationFee metas (config→stake→verifier); VM-named composition (EVM margin+gas; SVM margin-only); fee panel admits via txWriteAvailability + TxWriteRefusal; hub admits SVM fee island via admitKarProHub; SVM current fee named unread until U7; no staking/address write props",
    guardTests: ["set-verification-fee-policy.test.ts"],
  },
  {
    id: "surface-support",
    owner:
      "Sole capability × commercial-namespace support reader and write-availability composition",
    ownerFiles: [
      "lib/web3/surface-support.ts",
      "lib/web3/tx-write-availability.ts",
      "lib/web3/write-lifecycle.ts",
      "lib/web3/evm-write-lifecycle.ts",
    ],
    rule: "Sole reader for capability × commercial namespace support + wanted wallet family; class derived from SVM cell (never a second table); txWriteAvailabilityForCapability composes support then session (disconnected first); census fixture adds descriptive columns only; no parallel capability address registry",
    guardTests: ["surface-support-policy.test.ts"],
  },
  {
    id: "svm-write-census",
    owner: "test/svm-write-census-policy.test.ts",
    rule: "Sole enumerated set of product write-site files under app|components|hooks (excludes use-tx-sync); human action matrix is local research annex only and never imported by tests",
    guardTests: ["svm-write-census-policy.test.ts"],
  },
  {
    id: "policy-suite-scanned-tree-mutation",
    owner: "test/policy-suite-scanned-tree-mutation-policy.test.ts",
    rule: "Policy suites must not writeFileSync/mkdirSync/rmSync/… into live scanned roots (app|components|hooks|lib|src|scripts); plants use in-memory or mkdtemp outside the repository",
    guardTests: ["policy-suite-scanned-tree-mutation-policy.test.ts"],
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
    owner:
      "Sole keyed batch read door (EVM useReadContracts + SVM getMultipleAccounts sibling)",
    ownerFiles: ["lib/web3/keyed-multicall.ts"],
    rule: "useReadContracts + async SVM batch sibling only inside keyed-multicall; SVM arm = TanStack useQuery keyed by sorted unique accounts (shared cache, honors enabled/staleTime); product default = createProductSvmKeyedAccountSource (svm-rpc getMultipleAccounts); explicit null → unresolved_namespace; refuse mixed EVM/SVM batches by name; KeyedEntry = success | pending | refused(KeyedReadCause) — wait and refusal never share a value or Error.message; passport-detail-view mounts PassportCommerce once",
    guardTests: [
      "keyed-multicall-policy.test.ts",
      "s8-3-write-path.test.ts",
      "svm-keyed-read-policy.test.ts",
      "keyed-entry-status-policy.test.ts",
    ],
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
    rule: "Protocol address normalize/compare by namespace; ProtocolOwner brand minted only via mintProtocolOwner at entity ingress — not assignable to 0x without isEvmHexAddress; no dual toLowerCase match",
    guardTests: [
      "network-class-policy.test.ts",
      "protocol-owner-policy.test.ts",
    ],
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
    owner:
      "Sole who-is-connected entry and EVM session predicates; one ActiveAccountProvider per app; wagmi account hooks only in the EVM adapter",
    ownerFiles: [
      "lib/web3/active-account.ts",
      "lib/web3/active-account-provider.tsx",
      "hooks/use-active-account.ts",
      "lib/web3/evm-account-adapter.ts",
    ],
    rule: "One ActiveAccountProvider computes the session (adapters + discovery once); useActiveAccount reads context only; EVM facts via requireEvmSession / commercialNamespaceOf / switch availability (named causes); wagmi account hooks only in evm-account-adapter; observed family conflict + standard:events via pure decisions; no invented SVM namespace; no EVM-field undefined forks outside owners",
    guardTests: [
      "active-account-owner-policy.test.ts",
      "active-account-session-policy.test.ts",
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
    rule: "app|components|hooks must not invent a commercial namespace: no COMMERCIAL_ACTIVE[<literal>], no ??/|| commercial id fallback (registry-derived), no indexerQueryKey/openableTermsQueryKey namespace via ??/|| 0",
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
    rule: "SPL claim PDAs + per-subject bond PDAs; no push_ok/transfer_ok; no global pending maps; S32 split one Rust owner; SPEC verification challenge bond names EVM msg.value vs SVM dispute_deposit→challenge PDA with no native-push→claim fallback (D-01)",
    guardTests: ["svm-money-model-policy.test.ts"],
  },
  {
    id: "svm-consignment-automaton",
    owner: "svm/crates/kargain-consignment-base",
    rule: "Shared Mandate+Recall+ConsignmentBase transitions; require_can_open order; custody=owner move; split via agented-split; payout via claimable-payouts; validator surfaces: consignment-harness (automaton) + kar-fixed-price (mode)",
    guardTests: ["svm-consignment-automaton-policy.test.ts"],
  },
  {
    id: "svm-mode-config-authority",
    owner: "svm/crates/kargain-config-authority::admit_config_authority",
    rule: "Sole pure config-authority admit (unsigned→MissingRequiredSignature, wrong-key→NotOwner); modes(+harness) reach it via consignment-base require_config_authority (PDA then admit); passport via load_config then admit; no inline authority-key compare outside the admit owner",
    guardTests: ["svm-mode-config-authority-policy.test.ts"],
  },
  {
    id: "svm-core-custody",
    owner: "svm/crates/kargain-consignment-base::core_custody · svm/crates/kargain-passport-asset",
    rule: "Sole Core custody helpers (binding via kargain-passport-asset PDA+liveness, AssetFrozen freeze gate before every public TransferV1, TransferDelegate read, owner/delegate/custody moves); passport keeps its own core_asset CPI door; skip-freeze plant harness-only; modes must not TransferV1CpiBuilder — FixedPrice consumes movers (step 5), Ascending waits for step 6",
    guardTests: ["svm-core-custody-policy.test.ts"],
  },
  {
    id: "svm-fixed-price-core-custody",
    owner: "svm/programs/kar-fixed-price",
    rule: "FixedPrice trades Core passport via shared movers + passport May/registry; no HarnessAsset / load_asset / take_custody / release_custody / is_escrow_approved / self_encumbrance_registered / read_may_open / write_may_open",
    guardTests: ["svm-fixed-price-core-custody-policy.test.ts"],
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
    id: "passport-commerce-facts",
    owner:
      "lib/passport/passport-commerce-facts.ts · lib/passport/commerce-fact.ts · lib/passport/passport-commerce-rail.ts · hooks/use-passport-commerce-facts.ts · lib/web3/supported-chains.ts",
    rule: "Dual-VM passport commerce chrome: EVM batched may/custodyLocked/encumbrance/modes; SVM PassportState → custodyLock + surfaceSupport refusals for owed cells (never invent hasLiveConsignment false or configured false); CommerceFact = known|pending|refused(KeyedReadCause|SurfaceSupportCause); wagmiChainId only inside the EVM plan arm; eip155WagmiChainId returns undefined for commercial SVM",
    guardTests: [
      "passport-detail-svm-chrome-policy.test.ts",
      "commerce-fact-status-policy.test.ts",
      "commerce-fact-matrix.test.ts",
    ],
  },
  {
    id: "passport-detail-svm-chrome",
    owner:
      "components/passport/passport-detail-view.tsx · components/passport/passport-actions-panel.tsx · lib/marketplace/passport-custody.ts · lib/passport/passport-owner.ts · lib/web3/protocol-address.ts · lib/web3/supported-chains.ts · lib/passport/passport-commerce-facts.ts",
    rule: "Marketplace passport detail route: no wagmiChainId in the import-graph components/hooks; entity owner is ProtocolOwner (type wall — not text scanners for as 0x / getAddress); escrow custody is namespace-scoped via protocol-address; actions session chrome is txWriteAvailability + TxWriteRefusal only",
    guardTests: [
      "passport-detail-svm-chrome-policy.test.ts",
      "protocol-owner-policy.test.ts",
    ],
  },
  {
    id: "passport-presence-deriver",
    owner:
      "lib/passport/presence.ts · lib/passport/action-surface.ts · lib/passport/bridge-surface.ts · hooks/use-passport-presence.ts · lib/passport/passport-commerce-facts.ts",
    rule: "derivePassportPresence only in named owners; components/routes consume answers; custodyLock on SVM from PassportState decode via commerce-facts — never invent unlocked or treat missing EVM address as pending; location_pending and location_refused never share a sentence",
    guardTests: [
      "passport-presence-owner-policy.test.ts",
      "passport-action-surface.test.ts",
      "passport-detail-svm-chrome-policy.test.ts",
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
    id: "svm-devnet-mint-passport",
    owner: "scripts/svm-devnet-mint-passport.ts",
    rule: "Sole Devnet MintPassport ops door: exactly one instruction via encodeSvmInstruction+deriveSvmPda; named config refusals; no evidence write, no staking, no hand-rolled MintPassport tag",
    guardTests: ["svm-devnet-mint-passport-policy.test.ts"],
  },
  {
    id: "svm-devnet-product-send",
    owner: "scripts/svm-devnet-product-send.ts",
    rule: "Sole Devnet product-owner send door: executeSetPassportUri only; node SvmSignAndSendPort with named wrong_wallet_standard_chain; no encode/derive/send/TransactionInstruction in the harness",
    guardTests: ["svm-devnet-product-send-policy.test.ts"],
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
