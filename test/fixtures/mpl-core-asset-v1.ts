/**
 * Stand-shaped MPL Core BaseAssetV1 account fixture for product decode tests.
 *
 * Layout matches workspace mpl-core 0.11.2 BaseAssetV1 + stand `coreOwner`
 * (bytes [1..33) = owner) and Rust consignment-base plant comment:
 * Key::AssetV1(1) + owner32 + UpdateAuthority::None(0) + empty name/uri + seq None(0).
 *
 * Owner pubkey bytes are deterministic (not a live chain dump). The live stand
 * case in `svm/stand` proves the same decoder against a freshly minted asset.
 */

import { mplCoreProgramId } from "@/lib/svm/foreign-programs";

/** Deterministic 32-byte owner used in this fixture. */
export const MPL_CORE_FIXTURE_OWNER_BYTES = Uint8Array.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff),
);

/**
 * Full BaseAssetV1 account data (owner-only consumers may truncate to 33 bytes
 * for short-path plants; this blob is the stand-shaped full account).
 */
export const MPL_CORE_FIXTURE_ACCOUNT_DATA: Uint8Array = (() => {
  const out = new Uint8Array(1 + 32 + 1 + 4 + 4 + 1);
  out[0] = 1; // Key::AssetV1
  out.set(MPL_CORE_FIXTURE_OWNER_BYTES, 1);
  out[33] = 0; // UpdateAuthority::None
  // name len 0 @ 34, uri len 0 @ 38, seq None @ 42 — already zero-filled
  return out;
})();

/** Program id that must own a live Core asset account. */
export function mplCoreFixtureAccountOwner(): string {
  return mplCoreProgramId();
}
