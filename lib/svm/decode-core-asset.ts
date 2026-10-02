/**
 * Sole product decoder for Metaplex Core `BaseAssetV1` owner.
 *
 * Layout authority: workspace `mpl-core =0.11.2`
 * (`svm/Cargo.toml` → `mpl-core-0.11.2/src/generated/accounts/base_asset_v1.rs`
 * + `generated/types/key.rs`):
 * - `Key::AssetV1 = 1` at byte 0
 * - `owner: Pubkey` at bytes `[1, 33)`
 *
 * Program-owner liveness matches Rust `kargain-core-liveness::is_live_core_asset`
 * (`account.owner == mpl_core::ID`). This module never invents an owner.
 */

import { mplCoreProgramId } from "@/lib/svm/foreign-programs";
import {
  encodeSvmPubkeyBytes,
  mintProtocolOwner,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";

/** `Key::AssetV1` discriminant — mpl-core `Key` enum, Uninitialized=0. */
export const MPL_CORE_ASSET_V1_KEY = 1 as const;

/** Minimum bytes for key + owner (name/uri/seq not required for owner decode). */
export const MPL_CORE_ASSET_V1_OWNER_MIN_LEN = 33 as const;

export type DecodeCoreAssetOwnerCause =
  | "not_core_program"
  | "not_asset_v1"
  | "truncated"
  | "owner_unmintable";

export type DecodeCoreAssetOwnerResult =
  | { ok: true; owner: ProtocolOwner; ownerBytes: Uint8Array }
  | { ok: false; cause: DecodeCoreAssetOwnerCause; detail: string };

export type DecodeCoreAssetOwnerInput = {
  /** Account data bytes from RPC. */
  data: Uint8Array;
  /** Wire account `owner` (program id that owns the account). */
  accountOwner: string;
  /** Commercial namespace used to mint {@link ProtocolOwner}. */
  namespace: number;
};

/**
 * Decode the Core asset owner from an MPL Core account.
 * Refuses by name when the program owner is wrong, key is not AssetV1, or data is short.
 */
export function decodeCoreAssetOwner(
  input: DecodeCoreAssetOwnerInput,
): DecodeCoreAssetOwnerResult {
  const expectedProgram = mplCoreProgramId();
  if (input.accountOwner !== expectedProgram) {
    return {
      ok: false,
      cause: "not_core_program",
      detail: `account owner ${input.accountOwner} ≠ mpl_core ${expectedProgram}`,
    };
  }
  if (input.data.length < MPL_CORE_ASSET_V1_OWNER_MIN_LEN) {
    return {
      ok: false,
      cause: "truncated",
      detail: `data length ${input.data.length} < ${MPL_CORE_ASSET_V1_OWNER_MIN_LEN}`,
    };
  }
  const key = input.data[0];
  if (key !== MPL_CORE_ASSET_V1_KEY) {
    return {
      ok: false,
      cause: "not_asset_v1",
      detail: `key byte ${key} ≠ AssetV1 (${MPL_CORE_ASSET_V1_KEY})`,
    };
  }
  const ownerBytes = input.data.subarray(1, 33);
  let base58: string;
  try {
    base58 = encodeSvmPubkeyBytes(ownerBytes);
  } catch (err) {
    return {
      ok: false,
      cause: "owner_unmintable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const owner = mintProtocolOwner(input.namespace, base58);
  if (owner == null) {
    return {
      ok: false,
      cause: "owner_unmintable",
      detail: `mintProtocolOwner refused ${base58}`,
    };
  }
  return { ok: true, owner, ownerBytes: Uint8Array.from(ownerBytes) };
}
