/**
 * Declared passport / bridge URI ceiling in UTF-8 bytes (SPEC §I.13).
 *
 * Sole TypeScript owner of this literal. Solidity mirror:
 * `contracts/lib/PassportUriCeiling.sol`. Rust mirror:
 * `svm/crates/kargain-errors` `PASSPORT_URI_CEILING_BYTES`.
 *
 * Derivation (S4a-2): production foreign-mint lz_receive list, no ALT, three
 * spare Endpoint account metas (h=3) → assembled tx 1208 ≤ 1232; EVM
 * destination gas model ≈ 342_669 ≪ 1_000_000. Product Irys `ar://` pointers
 * are 48–49 B.
 */
export const DECLARED_PASSPORT_URI_CEILING_BYTES = 160;
