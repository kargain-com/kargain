/**
 * Sole product decoder for commercial SVM account-state layouts needed to
 * assemble instructions (U7 scope law).
 *
 * Layout + goldens come from Rust `BorshSerialize` via the committed
 * `svm/crates/kargain-ix-wire/state.manifest.json`. This module never authors
 * goldens. Cursor decode: leading borsh payload only — trailing account padding
 * is ignored (matches on-chain `deserialize(&mut cursor)`, not `try_from_slice`).
 *
 * Today: PassportState only (`record_count` seeds AppendRecord / ReportDiscrepancy /
 * AppendAttestation record PDAs). No chrome amounts.
 */

import stateManifest from "../../svm/crates/kargain-ix-wire/state.manifest.json" with {
  type: "json",
};

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

const MANIFEST = stateManifest as StateManifest;

const LAYOUTS = new Map<string, StateLayoutEntry>(
  MANIFEST.layouts.map((l) => [l.id, l]),
);

const PASSPORT_STATE_ID = "kar-passport/PassportState";

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

  const expectedDisc = hexToBytes(layout.discriminatorHex);
  let offset = 0;
  const fields: Record<string, unknown> = {};

  for (const decl of layout.fields) {
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

  const disc = fields.discriminator as Uint8Array;
  if (!bytesEqual(disc, expectedDisc)) {
    return {
      ok: false,
      cause: "discriminator_mismatch",
      detail: `got:${bytesToHex(disc)} expected:${layout.discriminatorHex}`,
    };
  }

  return {
    ok: true,
    value: {
      discriminator: disc,
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
    bytesRead: offset,
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
