/**
 * Sole product decoder for commercial SVM account-state layouts needed to
 * assemble instructions or admission facts (U7 / U6.5 / U6.7.3).
 *
 * Layout + goldens come from Rust `BorshSerialize` via the committed
 * `svm/crates/kargain-ix-wire/state.manifest.json`. This module never authors
 * goldens.
 *
 * Layout honesty:
 * - Fixed-padded (`PassportState`, `StakeAccount`): cursor ignores trailing zeros.
 * - Exact (`ChallengeAccount`): payload == SPACE; fully-consumed pin is meaningful.
 * - Deliberately partial (`PassportConfig`): fields stop at `remainder_unmodelled`;
 *   unmodelled structured tail (next_token_id / vec / bump) is not walked.
 *   Fully-consumed is meaningless on a partial + variable account.
 *
 * Pubkeys on product surfaces are base58 via `encodeSvmPubkeyBytes` (never
 * `@solana/addresses` direct).
 */

import stateManifest from "../../svm/crates/kargain-ix-wire/state.manifest.json" with {
  type: "json",
};
import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";

export type StateFieldDecl = {
  name: string;
  type: string;
  len?: number;
};

export type StateLayoutEntry = {
  id: string;
  program: string;
  accountSpace: number;
  discriminatorHex: string;
  fields: StateFieldDecl[];
  sample: Record<string, unknown>;
  goldenHex: string;
  payloadLen: number;
};

export type StateManifest = {
  version: number;
  layouts: StateLayoutEntry[];
};

export type DecodeAccountStateCause =
  | "unknown_layout"
  | "discriminator_mismatch"
  | "truncated"
  | "malformed_field"
  | "unsupported_type";

export type PassportStateDecoded = {
  discriminator: Uint8Array;
  tokenId: Uint8Array;
  status: number;
  verifier: Uint8Array;
  verifiedAt: bigint;
  custodyLocked: boolean;
  burned: boolean;
  recordCount: number;
  bump: number;
};

export type DecodePassportStateOk = {
  ok: true;
  value: PassportStateDecoded;
  layout: StateLayoutEntry;
  /** Bytes consumed from the leading borsh payload (padding ignored). */
  bytesRead: number;
};

export type DecodePassportStateErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodePassportStateResult =
  | DecodePassportStateOk
  | DecodePassportStateErr;

/**
 * Product StakeAccount decode — only `active` is exposed.
 * amount / unlock_at / verification_fee stay undecoded for chrome.
 */
export type StakeAccountDecoded = {
  active: boolean;
};

export type DecodeStakeAccountOk = {
  ok: true;
  value: StakeAccountDecoded;
  layout: StateLayoutEntry;
  bytesRead: number;
};

export type DecodeStakeAccountErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodeStakeAccountResult =
  | DecodeStakeAccountOk
  | DecodeStakeAccountErr;

/** Product ChallengeAccount decode — challenger base58 only (judge/withdraw parties). */
export type ChallengeAccountDecoded = {
  challenger: string;
};

export type DecodeChallengeAccountOk = {
  ok: true;
  value: ChallengeAccountDecoded;
  layout: StateLayoutEntry;
  bytesRead: number;
};

export type DecodeChallengeAccountErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodeChallengeAccountResult =
  | DecodeChallengeAccountOk
  | DecodeChallengeAccountErr;

/**
 * Product PassportConfig decode — dispute deposit + forfeit recipient only.
 * Authority / namespace / vec / bump are not exported (partial layout).
 */
export type PassportConfigDecoded = {
  disputeDeposit: bigint;
  forfeitRecipient: string;
};

export type DecodePassportConfigOk = {
  ok: true;
  value: PassportConfigDecoded;
  layout: StateLayoutEntry;
  /** Bytes through the modelled prefix (stops at remainder_unmodelled). */
  bytesRead: number;
};

export type DecodePassportConfigErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodePassportConfigResult =
  | DecodePassportConfigOk
  | DecodePassportConfigErr;

const MANIFEST = stateManifest as StateManifest;

const LAYOUTS = new Map<string, StateLayoutEntry>(
  MANIFEST.layouts.map((l) => [l.id, l]),
);

const PASSPORT_STATE_ID = "kar-passport/PassportState";
const STAKE_ACCOUNT_ID = "kar-pro-staking/StakeAccount";
const CHALLENGE_ACCOUNT_ID = "kargain-bonded-challenge/ChallengeAccount";
const PASSPORT_CONFIG_ID = "kar-passport/PassportConfig";

function pubkeyBase58(bytes: Uint8Array): string {
  return encodeSvmPubkeyBytes(bytes);
}

export function stateManifestLayouts(): readonly StateLayoutEntry[] {
  return MANIFEST.layouts;
}

export function passportStateLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(PASSPORT_STATE_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${PASSPORT_STATE_ID}`);
  }
  return layout;
}

export function stakeAccountLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(STAKE_ACCOUNT_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${STAKE_ACCOUNT_ID}`);
  }
  return layout;
}

export function challengeAccountLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(CHALLENGE_ACCOUNT_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${CHALLENGE_ACCOUNT_ID}`);
  }
  return layout;
}

export function passportConfigLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(PASSPORT_CONFIG_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${PASSPORT_CONFIG_ID}`);
  }
  return layout;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`odd_hex_len:${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type CursorDecodeOk = {
  ok: true;
  fields: Record<string, unknown>;
  bytesRead: number;
  layout: StateLayoutEntry;
};

type CursorDecodeErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

/**
 * Walk declared fields. Stops at `remainder_unmodelled` without consuming
 * further bytes. Refuses layouts that place any field after the marker.
 */
function decodeLayoutCursor(
  data: Uint8Array,
  layout: StateLayoutEntry,
): CursorDecodeOk | CursorDecodeErr {
  const markerIndex = layout.fields.findIndex(
    (f) => f.type === "remainder_unmodelled",
  );
  if (markerIndex >= 0 && markerIndex !== layout.fields.length - 1) {
    return {
      ok: false,
      cause: "unsupported_type",
      detail: "remainder_unmodelled_not_terminal",
    };
  }

  const expectedDisc = hexToBytes(layout.discriminatorHex);
  let offset = 0;
  const fields: Record<string, unknown> = {};

  for (const decl of layout.fields) {
    if (decl.type === "remainder_unmodelled") {
      // Terminal: do not walk past. Unmodelled structured remainder stays unread.
      break;
    }
    const decoded = decodeField(data, offset, decl);
    if (!decoded.ok) {
      return {
        ok: false,
        cause: decoded.cause,
        detail: `${decoded.cause}:${decl.name}:${decoded.detail}`,
      };
    }
    fields[decl.name] = decoded.value;
    offset = decoded.nextOffset;
  }

  const disc = fields.discriminator as Uint8Array | undefined;
  if (disc == null || !bytesEqual(disc, expectedDisc)) {
    return {
      ok: false,
      cause: "discriminator_mismatch",
      detail: `got:${disc ? bytesToHex(disc) : "missing"} expected:${layout.discriminatorHex}`,
    };
  }

  return { ok: true, fields, bytesRead: offset, layout };
}

/**
 * Decode a PassportState account. Ignores trailing padding after the borsh
 * payload. Verifies the discriminator against the Rust-authored manifest.
 */
export function decodePassportState(
  data: Uint8Array,
): DecodePassportStateResult {
  const layout = LAYOUTS.get(PASSPORT_STATE_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: PASSPORT_STATE_ID,
    };
  }

  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;
  const { fields } = cursor;

  return {
    ok: true,
    value: {
      discriminator: fields.discriminator as Uint8Array,
      tokenId: fields.token_id as Uint8Array,
      status: fields.status as number,
      verifier: fields.verifier as Uint8Array,
      verifiedAt: fields.verified_at as bigint,
      custodyLocked: fields.custody_locked as boolean,
      burned: fields.burned as boolean,
      recordCount: fields.record_count as number,
      bump: fields.bump as number,
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

/**
 * Strict decoder for the padding negative control only — requires the buffer
 * to be fully consumed (the defect class Rust comments forbid).
 * Not a product path.
 */
export function decodePassportStateStrictFullyConsumedForTests(
  data: Uint8Array,
): DecodePassportStateResult {
  const cursor = decodePassportState(data);
  if (!cursor.ok) return cursor;
  if (cursor.bytesRead !== data.length) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: `trailing_bytes:${data.length - cursor.bytesRead}`,
    };
  }
  return cursor;
}

/**
 * Decode a StakeAccount for the active-verifier admission fact.
 * Cursor decode ignores trailing padding. Product value is `{ active }` only.
 */
export function decodeStakeAccount(data: Uint8Array): DecodeStakeAccountResult {
  const layout = LAYOUTS.get(STAKE_ACCOUNT_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: STAKE_ACCOUNT_ID,
    };
  }

  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;

  return {
    ok: true,
    value: {
      active: cursor.fields.active as boolean,
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

/**
 * Strict StakeAccount decoder for the padding negative control only.
 * Not a product path.
 */
export function decodeStakeAccountStrictFullyConsumedForTests(
  data: Uint8Array,
): DecodeStakeAccountResult {
  const cursor = decodeStakeAccount(data);
  if (!cursor.ok) return cursor;
  if (cursor.bytesRead !== data.length) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: `trailing_bytes:${data.length - cursor.bytesRead}`,
    };
  }
  return cursor;
}

/**
 * Decode a ChallengeAccount. Exact SPACE — fully-consumed pin is meaningful.
 * Product surface: challenger base58 only.
 */
export function decodeChallengeAccount(
  data: Uint8Array,
): DecodeChallengeAccountResult {
  const layout = LAYOUTS.get(CHALLENGE_ACCOUNT_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: CHALLENGE_ACCOUNT_ID,
    };
  }

  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;

  const challengerBytes = cursor.fields.challenger as Uint8Array;
  return {
    ok: true,
    value: {
      challenger: pubkeyBase58(challengerBytes),
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

/**
 * Strict ChallengeAccount decoder — green on the exact golden; red with a
 * trailing byte. Not a product path.
 */
export function decodeChallengeAccountStrictFullyConsumedForTests(
  data: Uint8Array,
): DecodeChallengeAccountResult {
  const cursor = decodeChallengeAccount(data);
  if (!cursor.ok) return cursor;
  if (cursor.bytesRead !== data.length) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: `trailing_bytes:${data.length - cursor.bytesRead}`,
    };
  }
  return cursor;
}

/**
 * Decode PassportConfig modelled prefix (through forfeit_recipient).
 * Stops at remainder_unmodelled — does not walk next_token_id / vec / bump.
 * No fully-consumed export (meaningless on partial + variable tail).
 */
export function decodePassportConfig(
  data: Uint8Array,
): DecodePassportConfigResult {
  const layout = LAYOUTS.get(PASSPORT_CONFIG_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: PASSPORT_CONFIG_ID,
    };
  }

  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;

  const forfeitBytes = cursor.fields.forfeit_recipient as Uint8Array;
  return {
    ok: true,
    value: {
      disputeDeposit: cursor.fields.dispute_deposit as bigint,
      forfeitRecipient: pubkeyBase58(forfeitBytes),
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

/**
 * Test-only cursor walk with an injected field list (plants: omit-u128,
 * field-after-marker, decode-past-marker). Not a product path.
 */
export function decodePassportConfigWithFieldsForTests(
  data: Uint8Array,
  fields: StateFieldDecl[],
): DecodePassportConfigResult {
  const base = LAYOUTS.get(PASSPORT_CONFIG_ID);
  if (!base) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: PASSPORT_CONFIG_ID,
    };
  }
  const planted: StateLayoutEntry = { ...base, fields };
  const cursor = decodeLayoutCursor(data, planted);
  if (!cursor.ok) return cursor;
  const forfeitBytes = cursor.fields.forfeit_recipient as Uint8Array | undefined;
  const deposit = cursor.fields.dispute_deposit as bigint | undefined;
  if (deposit == null || forfeitBytes == null) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: "planted_missing_product_fields",
    };
  }
  return {
    ok: true,
    value: {
      disputeDeposit: deposit,
      forfeitRecipient: pubkeyBase58(forfeitBytes),
    },
    layout: planted,
    bytesRead: cursor.bytesRead,
  };
}

/**
 * Plant helper: walk fields and keep reading after remainder_unmodelled
 * (forbidden). Used only by the policy suite.
 */
export function decodePastRemainderMarkerForTests(
  data: Uint8Array,
  layout: StateLayoutEntry,
): { ok: true; bytesRead: number } | CursorDecodeErr {
  let offset = 0;
  let sawMarker = false;
  for (const decl of layout.fields) {
    if (decl.type === "remainder_unmodelled") {
      sawMarker = true;
      continue; // plant: do not stop — keep walking
    }
    if (!sawMarker) {
      const decoded = decodeField(data, offset, decl);
      if (!decoded.ok) {
        return {
          ok: false,
          cause: decoded.cause,
          detail: `${decoded.cause}:${decl.name}:${decoded.detail}`,
        };
      }
      offset = decoded.nextOffset;
      continue;
    }
    // Past marker — attempt to consume as if the next declared type were real.
    const decoded = decodeField(data, offset, decl);
    if (!decoded.ok) {
      return {
        ok: false,
        cause: decoded.cause,
        detail: `past_marker:${decl.name}:${decoded.detail}`,
      };
    }
    offset = decoded.nextOffset;
  }
  if (!sawMarker) {
    return {
      ok: false,
      cause: "unsupported_type",
      detail: "no_remainder_marker",
    };
  }
  return { ok: true, bytesRead: offset };
}

type FieldDecodeOk = {
  ok: true;
  value: unknown;
  nextOffset: number;
};
type FieldDecodeErr = {
  ok: false;
  cause: "truncated" | "malformed_field" | "unsupported_type";
  detail: string;
};

function decodeField(
  data: Uint8Array,
  offset: number,
  decl: StateFieldDecl,
): FieldDecodeOk | FieldDecodeErr {
  switch (decl.type) {
    case "u8":
      return decodeUint(data, offset, 1, (n) => Number(n));
    case "u16":
      return decodeUint(data, offset, 2, (n) => Number(n));
    case "u32":
      return decodeUint(data, offset, 4, (n) => Number(n));
    case "u64":
      return decodeUint(data, offset, 8, (n) => n);
    case "u128":
      return decodeUint(data, offset, 16, (n) => n);
    case "bool": {
      if (offset + 1 > data.length) {
        return { ok: false, cause: "truncated", detail: "bool" };
      }
      const b = data[offset]!;
      if (b !== 0 && b !== 1) {
        return {
          ok: false,
          cause: "malformed_field",
          detail: `bool_byte:${b}`,
        };
      }
      return { ok: true, value: b === 1, nextOffset: offset + 1 };
    }
    case "fixed_bytes": {
      if (decl.len == null || !Number.isInteger(decl.len) || decl.len < 0) {
        return {
          ok: false,
          cause: "unsupported_type",
          detail: "fixed_bytes_missing_len",
        };
      }
      if (offset + decl.len > data.length) {
        return {
          ok: false,
          cause: "truncated",
          detail: `fixed_bytes:${decl.len}`,
        };
      }
      return {
        ok: true,
        value: data.subarray(offset, offset + decl.len),
        nextOffset: offset + decl.len,
      };
    }
    case "remainder_unmodelled":
      // Handled by the cursor walker; reaching here is a layout error.
      return {
        ok: false,
        cause: "unsupported_type",
        detail: "remainder_unmodelled_via_decodeField",
      };
    default:
      return {
        ok: false,
        cause: "unsupported_type",
        detail: decl.type,
      };
  }
}

function decodeUint(
  data: Uint8Array,
  offset: number,
  width: number,
  map: (n: bigint) => unknown,
): FieldDecodeOk | FieldDecodeErr {
  if (offset + width > data.length) {
    return { ok: false, cause: "truncated", detail: `u${width * 8}` };
  }
  let n = 0n;
  for (let i = 0; i < width; i++) {
    n |= BigInt(data[offset + i]!) << BigInt(8 * i);
  }
  return { ok: true, value: map(n), nextOffset: offset + width };
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    s += b.toString(16).padStart(2, "0");
  }
  return s;
}
