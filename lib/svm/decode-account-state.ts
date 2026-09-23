/**
 * Sole product decoder for commercial SVM account-state layouts needed to
 * assemble instructions or admission facts (U7 / U6.5 / U6.7.3 / S8-E 9.2).
 *
 * Layout + goldens come from Rust `BorshSerialize` via the committed
 * `svm/crates/kargain-ix-wire/state.manifest.json`. This module never authors
 * goldens.
 *
 * Layout honesty:
 * - Fixed-padded (`PassportState`, `StakeAccount`): cursor ignores trailing zeros.
 * - Exact (`ChallengeAccount`, `EncumbranceAnswer`, `PassportBinding`,
 *   `CommerceConfig`, `AscendingConfig`): modelled == golden == SPACE.
 * - Variable (`PassportConfig`): fully modelled including `encumbrance_sources`
 *   (`vec_encumbrance_source`) + bump; golden length is the sample Borsh size.
 * Length fields are `goldenByteLength` / `modelledByteLength` — never
 * `accountSpace` / `payloadLen`. Neither is a rent SPACE unless it equals a
 * program `SPACE` constant.
 *
 * Pubkeys on product surfaces are base58 via `encodeSvmPubkeyBytes` (never
 * `@solana/addresses` direct).
 */

import stateManifest from "../../svm/crates/kargain-ix-wire/state.manifest.json" with {
  type: "json",
};
import { encodeSvmPubkeyBytes, svmPubkeyToBytes32 } from "@/lib/web3/protocol-address";

export type StateFieldDecl = {
  name: string;
  type: string;
  len?: number;
};

export type StateLayoutEntry = {
  id: string;
  program: string;
  goldenByteLength: number;
  discriminatorHex: string;
  fields: StateFieldDecl[];
  sample: Record<string, unknown>;
  goldenHex: string;
  modelledByteLength: number;
};

/** Retired length names must not re-enter a layout object. */
export type RetiredStateLengthNameCause = "retired_length_name";

export function refuseRetiredStateLengthNames(
  layout: Record<string, unknown>,
):
  | { ok: true }
  | { ok: false; cause: RetiredStateLengthNameCause; detail: string } {
  const retired: string[] = [];
  if (Object.prototype.hasOwnProperty.call(layout, "accountSpace")) {
    retired.push("accountSpace");
  }
  if (Object.prototype.hasOwnProperty.call(layout, "payloadLen")) {
    retired.push("payloadLen");
  }
  if (retired.length > 0) {
    return { ok: false, cause: "retired_length_name", detail: retired.join(",") };
  }
  return { ok: true };
}

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
 * Product PassportConfig — full modelled surface (deposit, forfeit, registry).
 */
export type EncumbranceSourceDecoded = {
  programId: string;
  seedPrefix: string;
  programIdBytes: Uint8Array;
  seedPrefixBytes: Uint8Array;
};

export type PassportConfigDecoded = {
  authority: string;
  namespace: bigint;
  localEid: number;
  endpointProgram: string;
  disputeDeposit: bigint;
  stakingProgram: string;
  bridgeGateway: string;
  forfeitRecipient: string;
  nextTokenId: Uint8Array;
  encumbranceSources: EncumbranceSourceDecoded[];
  bump: number;
};

export type DecodePassportConfigOk = {
  ok: true;
  value: PassportConfigDecoded;
  layout: StateLayoutEntry;
  /** Bytes consumed from the full modelled account. */
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

/** FixedPrice CommerceConfig — exact SPACE. */
export type CommerceConfigDecoded = {
  authority: string;
  platformRecipient: string;
  platformFeeBps: number;
  guardian: string;
  paused: boolean;
  selfEncumbranceRegisteredRetired: boolean;
  bump: number;
};

export type DecodeCommerceConfigOk = {
  ok: true;
  value: CommerceConfigDecoded;
  layout: StateLayoutEntry;
  bytesRead: number;
};

export type DecodeCommerceConfigErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodeCommerceConfigResult =
  | DecodeCommerceConfigOk
  | DecodeCommerceConfigErr;

/** AscendingConfig — exact SPACE. */
export type AscendingConfigDecoded = {
  authority: string;
  platformRecipient: string;
  platformFeeBps: number;
  guardian: string;
  paused: boolean;
  selfEncumbranceRegisteredRetired: boolean;
  stakingProgram: string;
  forfeitRecipient: string;
  challengeBond: bigint;
  challengeWindow: bigint;
  challengeConfigured: boolean;
  bump: number;
};

export type DecodeAscendingConfigOk = {
  ok: true;
  value: AscendingConfigDecoded;
  layout: StateLayoutEntry;
  bytesRead: number;
};

export type DecodeAscendingConfigErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodeAscendingConfigResult =
  | DecodeAscendingConfigOk
  | DecodeAscendingConfigErr;

/** Product EncumbranceAnswer — close paths need the recorded funder. */
export type EncumbranceAnswerDecoded = {
  tokenId: Uint8Array;
  intent: number;
  allowed: boolean;
  funder: string;
};

export type DecodeEncumbranceAnswerOk = {
  ok: true;
  value: EncumbranceAnswerDecoded;
  layout: StateLayoutEntry;
  bytesRead: number;
};

export type DecodeEncumbranceAnswerErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodeEncumbranceAnswerResult =
  | DecodeEncumbranceAnswerOk
  | DecodeEncumbranceAnswerErr;

/** Product PassportBinding — bound passport program + bump. */
export type PassportBindingDecoded = {
  passportProgram: string;
  bump: number;
};

export type DecodePassportBindingOk = {
  ok: true;
  value: PassportBindingDecoded;
  layout: StateLayoutEntry;
  bytesRead: number;
};

export type DecodePassportBindingErr = {
  ok: false;
  cause: DecodeAccountStateCause;
  detail: string;
};

export type DecodePassportBindingResult =
  | DecodePassportBindingOk
  | DecodePassportBindingErr;

const MANIFEST = stateManifest as StateManifest;

const LAYOUTS = new Map<string, StateLayoutEntry>(
  MANIFEST.layouts.map((l) => [l.id, l]),
);

const PASSPORT_STATE_ID = "kar-passport/PassportState";
const STAKE_ACCOUNT_ID = "kar-pro-staking/StakeAccount";
const CHALLENGE_ACCOUNT_ID = "kargain-bonded-challenge/ChallengeAccount";
const PASSPORT_CONFIG_ID = "kar-passport/PassportConfig";
const ENCUMBRANCE_ANSWER_ID = "kargain-encumbrance/EncumbranceAnswer";
const PASSPORT_BINDING_ID = "kargain-consignment-base/PassportBinding";
const COMMERCE_CONFIG_ID = "kargain-consignment-base/CommerceConfig";
const ASCENDING_CONFIG_ID = "kar-ascending/AscendingConfig";

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

export function encumbranceAnswerLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(ENCUMBRANCE_ANSWER_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${ENCUMBRANCE_ANSWER_ID}`);
  }
  return layout;
}

export function passportBindingLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(PASSPORT_BINDING_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${PASSPORT_BINDING_ID}`);
  }
  return layout;
}

export function commerceConfigLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(COMMERCE_CONFIG_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${COMMERCE_CONFIG_ID}`);
  }
  return layout;
}

export function ascendingConfigLayout(): StateLayoutEntry {
  const layout = LAYOUTS.get(ASCENDING_CONFIG_ID);
  if (!layout) {
    throw new Error(`state_manifest_missing:${ASCENDING_CONFIG_ID}`);
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
export function decodeEncumbranceAnswer(
  data: Uint8Array,
): DecodeEncumbranceAnswerResult {
  const layout = LAYOUTS.get(ENCUMBRANCE_ANSWER_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: ENCUMBRANCE_ANSWER_ID,
    };
  }

  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;

  const funderBytes = cursor.fields.funder as Uint8Array;
  return {
    ok: true,
    value: {
      tokenId: cursor.fields.token_id as Uint8Array,
      intent: cursor.fields.intent as number,
      allowed: cursor.fields.allowed as boolean,
      funder: pubkeyBase58(funderBytes),
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

export function decodeEncumbranceAnswerStrictFullyConsumedForTests(
  data: Uint8Array,
): DecodeEncumbranceAnswerResult {
  const cursor = decodeEncumbranceAnswer(data);
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

export function decodeEncumbranceAnswerWithFieldsForTests(
  data: Uint8Array,
  fields: StateFieldDecl[],
): DecodeEncumbranceAnswerResult {
  const base = LAYOUTS.get(ENCUMBRANCE_ANSWER_ID);
  if (!base) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: ENCUMBRANCE_ANSWER_ID,
    };
  }
  const planted: StateLayoutEntry = { ...base, fields };
  const cursor = decodeLayoutCursor(data, planted);
  if (!cursor.ok) return cursor;
  const funderBytes = cursor.fields.funder as Uint8Array | undefined;
  const tokenId = cursor.fields.token_id as Uint8Array | undefined;
  const intent = cursor.fields.intent as number | undefined;
  const allowed = cursor.fields.allowed as boolean | undefined;
  if (
    tokenId == null ||
    intent == null ||
    allowed == null ||
    funderBytes == null
  ) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: "planted_missing_product_fields",
    };
  }
  return {
    ok: true,
    value: {
      tokenId,
      intent,
      allowed,
      funder: pubkeyBase58(funderBytes),
    },
    layout: planted,
    bytesRead: cursor.bytesRead,
  };
}

export function decodePassportBinding(
  data: Uint8Array,
): DecodePassportBindingResult {
  const layout = LAYOUTS.get(PASSPORT_BINDING_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: PASSPORT_BINDING_ID,
    };
  }

  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;

  const programBytes = cursor.fields.passport_program as Uint8Array;
  return {
    ok: true,
    value: {
      passportProgram: pubkeyBase58(programBytes),
      bump: cursor.fields.bump as number,
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

export function decodePassportBindingStrictFullyConsumedForTests(
  data: Uint8Array,
): DecodePassportBindingResult {
  const cursor = decodePassportBinding(data);
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

export function decodePassportBindingWithFieldsForTests(
  data: Uint8Array,
  fields: StateFieldDecl[],
): DecodePassportBindingResult {
  const base = LAYOUTS.get(PASSPORT_BINDING_ID);
  if (!base) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: PASSPORT_BINDING_ID,
    };
  }
  const planted: StateLayoutEntry = { ...base, fields };
  const cursor = decodeLayoutCursor(data, planted);
  if (!cursor.ok) return cursor;
  const programBytes = cursor.fields.passport_program as Uint8Array | undefined;
  const bump = cursor.fields.bump as number | undefined;
  if (programBytes == null || bump == null) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: "planted_missing_product_fields",
    };
  }
  return {
    ok: true,
    value: {
      passportProgram: pubkeyBase58(programBytes),
      bump,
    },
    layout: planted,
    bytesRead: cursor.bytesRead,
  };
}

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

  const sources = cursor.fields.encumbrance_sources as EncumbranceSourceDecoded[];
  return {
    ok: true,
    value: {
      authority: pubkeyBase58(cursor.fields.authority as Uint8Array),
      namespace: cursor.fields.namespace as bigint,
      localEid: cursor.fields.local_eid as number,
      endpointProgram: pubkeyBase58(cursor.fields.endpoint_program as Uint8Array),
      disputeDeposit: cursor.fields.dispute_deposit as bigint,
      stakingProgram: pubkeyBase58(cursor.fields.staking_program as Uint8Array),
      bridgeGateway: pubkeyBase58(cursor.fields.bridge_gateway as Uint8Array),
      forfeitRecipient: pubkeyBase58(
        cursor.fields.forfeit_recipient as Uint8Array,
      ),
      nextTokenId: cursor.fields.next_token_id as Uint8Array,
      encumbranceSources: sources,
      bump: cursor.fields.bump as number,
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

/**
 * Borsh-encode a PassportConfig account from decoded/product fields.
 * Sole owner of the registry reshape used for rent-size planning.
 */
export function encodePassportConfigAccount(
  value: PassportConfigDecoded,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const push = (chunk: Uint8Array) => {
    parts.push(chunk);
  };
  const layout = passportConfigLayout();
  push(hexToBytes(layout.discriminatorHex));
  push(decodeBase58To32(value.authority));
  push(u128LeBytes(value.namespace));
  push(u32LeBytes(value.localEid));
  push(decodeBase58To32(value.endpointProgram));
  push(u64LeBytes(value.disputeDeposit));
  push(decodeBase58To32(value.stakingProgram));
  push(decodeBase58To32(value.bridgeGateway));
  push(decodeBase58To32(value.forfeitRecipient));
  push(Uint8Array.from(value.nextTokenId));
  push(u32LeBytes(value.encumbranceSources.length));
  for (const s of value.encumbranceSources) {
    push(Uint8Array.from(s.programIdBytes));
    push(u32LeBytes(s.seedPrefixBytes.length));
    push(Uint8Array.from(s.seedPrefixBytes));
  }
  push(Uint8Array.of(value.bump & 0xff));
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Replace encumbrance_sources on a live account while preserving other fields. */
export function encodePassportConfigWithSources(
  currentData: Uint8Array,
  sources: readonly {
    programIdBytes: Uint8Array;
    seedPrefixBytes: Uint8Array;
  }[],
): Uint8Array {
  const decoded = decodePassportConfig(currentData);
  if (!decoded.ok) {
    throw new Error(`encode_passport_config:${decoded.cause}:${decoded.detail}`);
  }
  const next: PassportConfigDecoded = {
    ...decoded.value,
    encumbranceSources: sources.map((s) => ({
      programId: pubkeyBase58(s.programIdBytes),
      seedPrefix: new TextDecoder().decode(s.seedPrefixBytes),
      programIdBytes: Uint8Array.from(s.programIdBytes),
      seedPrefixBytes: Uint8Array.from(s.seedPrefixBytes),
    })),
  };
  return encodePassportConfigAccount(next);
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
  const authorityBytes = cursor.fields.authority as Uint8Array | undefined;
  const namespace = cursor.fields.namespace as bigint | undefined;
  if (deposit == null || forfeitBytes == null || authorityBytes == null || namespace == null) {
    return {
      ok: false,
      cause: "malformed_field",
      detail: "planted_missing_product_fields",
    };
  }
  const sources =
    (cursor.fields.encumbrance_sources as EncumbranceSourceDecoded[] | undefined) ??
    [];
  const nextTokenId =
    (cursor.fields.next_token_id as Uint8Array | undefined) ?? new Uint8Array(32);
  const bump = (cursor.fields.bump as number | undefined) ?? 0;
  const endpoint =
    (cursor.fields.endpoint_program as Uint8Array | undefined) ?? new Uint8Array(32);
  const staking =
    (cursor.fields.staking_program as Uint8Array | undefined) ?? new Uint8Array(32);
  const gateway =
    (cursor.fields.bridge_gateway as Uint8Array | undefined) ?? new Uint8Array(32);
  const localEid = (cursor.fields.local_eid as number | undefined) ?? 0;
  return {
    ok: true,
    value: {
      authority: pubkeyBase58(authorityBytes),
      namespace,
      localEid,
      endpointProgram: pubkeyBase58(endpoint),
      disputeDeposit: deposit,
      stakingProgram: pubkeyBase58(staking),
      bridgeGateway: pubkeyBase58(gateway),
      forfeitRecipient: pubkeyBase58(forfeitBytes),
      nextTokenId,
      encumbranceSources: sources,
      bump,
    },
    layout: planted,
    bytesRead: cursor.bytesRead,
  };
}

export function decodeCommerceConfig(
  data: Uint8Array,
): DecodeCommerceConfigResult {
  const layout = LAYOUTS.get(COMMERCE_CONFIG_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: COMMERCE_CONFIG_ID,
    };
  }
  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;
  return {
    ok: true,
    value: {
      authority: pubkeyBase58(cursor.fields.authority as Uint8Array),
      platformRecipient: pubkeyBase58(
        cursor.fields.platform_recipient as Uint8Array,
      ),
      platformFeeBps: cursor.fields.platform_fee_bps as number,
      guardian: pubkeyBase58(cursor.fields.guardian as Uint8Array),
      paused: cursor.fields.paused as boolean,
      selfEncumbranceRegisteredRetired: cursor.fields
        .self_encumbrance_registered_retired as boolean,
      bump: cursor.fields.bump as number,
    },
    layout,
    bytesRead: cursor.bytesRead,
  };
}

export function decodeAscendingConfig(
  data: Uint8Array,
): DecodeAscendingConfigResult {
  const layout = LAYOUTS.get(ASCENDING_CONFIG_ID);
  if (!layout) {
    return {
      ok: false,
      cause: "unknown_layout",
      detail: ASCENDING_CONFIG_ID,
    };
  }
  const cursor = decodeLayoutCursor(data, layout);
  if (!cursor.ok) return cursor;
  return {
    ok: true,
    value: {
      authority: pubkeyBase58(cursor.fields.authority as Uint8Array),
      platformRecipient: pubkeyBase58(
        cursor.fields.platform_recipient as Uint8Array,
      ),
      platformFeeBps: cursor.fields.platform_fee_bps as number,
      guardian: pubkeyBase58(cursor.fields.guardian as Uint8Array),
      paused: cursor.fields.paused as boolean,
      selfEncumbranceRegisteredRetired: cursor.fields
        .self_encumbrance_registered_retired as boolean,
      stakingProgram: pubkeyBase58(cursor.fields.staking_program as Uint8Array),
      forfeitRecipient: pubkeyBase58(
        cursor.fields.forfeit_recipient as Uint8Array,
      ),
      challengeBond: cursor.fields.challenge_bond as bigint,
      challengeWindow: cursor.fields.challenge_window as bigint,
      challengeConfigured: cursor.fields.challenge_configured as boolean,
      bump: cursor.fields.bump as number,
    },
    layout,
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
    case "vec_encumbrance_source": {
      if (offset + 4 > data.length) {
        return { ok: false, cause: "truncated", detail: "vec_encumbrance_source:count" };
      }
      let o = offset;
      const count = Number(
        BigInt(data[o]!) |
          (BigInt(data[o + 1]!) << 8n) |
          (BigInt(data[o + 2]!) << 16n) |
          (BigInt(data[o + 3]!) << 24n),
      );
      o += 4;
      const sources: EncumbranceSourceDecoded[] = [];
      for (let i = 0; i < count; i++) {
        if (o + 32 + 4 > data.length) {
          return {
            ok: false,
            cause: "truncated",
            detail: `vec_encumbrance_source:entry:${i}`,
          };
        }
        const programIdBytes = Uint8Array.from(data.subarray(o, o + 32));
        o += 32;
        const prefixLen = Number(
          BigInt(data[o]!) |
            (BigInt(data[o + 1]!) << 8n) |
            (BigInt(data[o + 2]!) << 16n) |
            (BigInt(data[o + 3]!) << 24n),
        );
        o += 4;
        if (o + prefixLen > data.length) {
          return {
            ok: false,
            cause: "truncated",
            detail: `vec_encumbrance_source:prefix:${i}`,
          };
        }
        const seedPrefixBytes = Uint8Array.from(data.subarray(o, o + prefixLen));
        o += prefixLen;
        sources.push({
          programId: pubkeyBase58(programIdBytes),
          seedPrefix: new TextDecoder().decode(seedPrefixBytes),
          programIdBytes,
          seedPrefixBytes,
        });
      }
      return { ok: true, value: sources, nextOffset: o };
    }
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

function decodeBase58To32(base58: string): Uint8Array {
  return hexToBytes(svmPubkeyToBytes32(base58).slice(2));
}

function u32LeBytes(n: number): Uint8Array {
  const out = new Uint8Array(4);
  const v = n >>> 0;
  out[0] = v & 0xff;
  out[1] = (v >>> 8) & 0xff;
  out[2] = (v >>> 16) & 0xff;
  out[3] = (v >>> 24) & 0xff;
  return out;
}

function u64LeBytes(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function u128LeBytes(n: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let v = n;
  for (let i = 0; i < 16; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
