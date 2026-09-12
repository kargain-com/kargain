/**
 * Sole product encoder for commercial SVM instruction data bytes.
 *
 * Layout + goldens come from Rust `BorshSerialize` via the committed
 * `svm/crates/kargain-ix-wire/ix.manifest.json`. This module never authors
 * goldens. No account metas, no program ids, no Buffer, no web3.js.
 */

import ixManifest from "../../svm/crates/kargain-ix-wire/ix.manifest.json" with {
  type: "json",
};

export type IxWireType =
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "u128"
  | "bool"
  | "string"
  | "vec_u8"
  | "fixed_bytes";

export type IxFieldDecl = {
  name: string;
  type: string;
  len?: number;
};

export type IxManifestEntry = {
  program: string;
  enum: string;
  index: number;
  name: string;
  fields: IxFieldDecl[];
  sample: Record<string, unknown>;
  goldenHex: string;
};

export type IxManifest = {
  version: number;
  entries: IxManifestEntry[];
};

export type EncodeInstructionCause =
  | "unknown_program"
  | "unknown_variant"
  | "missing_field"
  | "unexpected_field"
  | "value_out_of_range"
  | "unsupported_type";

export type EncodeInstructionOk = {
  ok: true;
  data: Uint8Array;
  entry: IxManifestEntry;
};

export type EncodeInstructionErr = {
  ok: false;
  cause: EncodeInstructionCause;
  detail: string;
};

export type EncodeInstructionResult = EncodeInstructionOk | EncodeInstructionErr;

export type InstructionFieldValue =
  | number
  | bigint
  | boolean
  | string
  | Uint8Array;

const MANIFEST = ixManifest as IxManifest;

const ENTRIES: readonly IxManifestEntry[] = MANIFEST.entries;

const BY_PROGRAM_VARIANT = new Map<string, IxManifestEntry>(
  ENTRIES.map((e) => [`${e.program}:${e.name}`, e]),
);

const PROGRAMS = new Set(ENTRIES.map((e) => e.program));

export function ixManifestEntries(): readonly IxManifestEntry[] {
  return ENTRIES;
}

export function encodeSvmInstruction(args: {
  program: string;
  variant: string;
  fields: Record<string, InstructionFieldValue>;
}): EncodeInstructionResult {
  const { program, variant, fields } = args;
  if (!PROGRAMS.has(program)) {
    return {
      ok: false,
      cause: "unknown_program",
      detail: `unknown_program:${program}`,
    };
  }
  const entry = BY_PROGRAM_VARIANT.get(`${program}:${variant}`);
  if (!entry) {
    return {
      ok: false,
      cause: "unknown_variant",
      detail: `unknown_variant:${program}:${variant}`,
    };
  }

  const expected = new Set(entry.fields.map((f) => f.name));
  for (const key of Object.keys(fields)) {
    if (!expected.has(key)) {
      return {
        ok: false,
        cause: "unexpected_field",
        detail: `unexpected_field:${program}:${variant}:${key}`,
      };
    }
  }
  for (const f of entry.fields) {
    if (!(f.name in fields)) {
      return {
        ok: false,
        cause: "missing_field",
        detail: `missing_field:${program}:${variant}:${f.name}`,
      };
    }
  }

  const chunks: Uint8Array[] = [Uint8Array.of(entry.index & 0xff)];
  for (const f of entry.fields) {
    const encoded = encodeField(f, fields[f.name]!);
    if (!encoded.ok) {
      return {
        ok: false,
        cause: encoded.cause,
        detail: `${encoded.cause}:${program}:${variant}:${f.name}:${encoded.detail}`,
      };
    }
    chunks.push(encoded.bytes);
  }

  return { ok: true, data: concatBytes(chunks), entry };
}

type FieldEncodeOk = { ok: true; bytes: Uint8Array };
type FieldEncodeErr = {
  ok: false;
  cause: "value_out_of_range" | "unsupported_type";
  detail: string;
};

function encodeField(
  decl: IxFieldDecl,
  value: InstructionFieldValue,
): FieldEncodeOk | FieldEncodeErr {
  switch (decl.type) {
    case "u8":
      return encodeUint(value, 8n, 1);
    case "u16":
      return encodeUint(value, 16n, 2);
    case "u32":
      return encodeUint(value, 32n, 4);
    case "u64":
      return encodeUint(value, 64n, 8);
    case "u128":
      return encodeUint(value, 128n, 16);
    case "bool": {
      if (typeof value !== "boolean") {
        return {
          ok: false,
          cause: "value_out_of_range",
          detail: "bool_not_boolean",
        };
      }
      return { ok: true, bytes: Uint8Array.of(value ? 1 : 0) };
    }
    case "string": {
      if (typeof value !== "string") {
        return {
          ok: false,
          cause: "value_out_of_range",
          detail: "string_not_string",
        };
      }
      const body = new TextEncoder().encode(value);
      return { ok: true, bytes: concatBytes([encodeU32Le(body.length), body]) };
    }
    case "vec_u8": {
      const body = coerceBytes(value);
      if (!body.ok) return body;
      return {
        ok: true,
        bytes: concatBytes([encodeU32Le(body.bytes.length), body.bytes]),
      };
    }
    case "fixed_bytes": {
      if (decl.len == null || !Number.isInteger(decl.len) || decl.len < 0) {
        return {
          ok: false,
          cause: "unsupported_type",
          detail: "fixed_bytes_missing_len",
        };
      }
      const body = coerceBytes(value);
      if (!body.ok) return body;
      if (body.bytes.length !== decl.len) {
        return {
          ok: false,
          cause: "value_out_of_range",
          detail: `fixed_bytes_len:${body.bytes.length}!=${decl.len}`,
        };
      }
      return { ok: true, bytes: body.bytes };
    }
    default:
      return {
        ok: false,
        cause: "unsupported_type",
        detail: decl.type,
      };
  }
}

/** Test seam: prove `unsupported_type` without forging a committed manifest row. */
export function encodeDeclaredFieldForTests(
  decl: IxFieldDecl,
  value: InstructionFieldValue,
): FieldEncodeOk | FieldEncodeErr {
  return encodeField(decl, value);
}

function encodeUint(
  value: InstructionFieldValue,
  bits: bigint,
  width: number,
): FieldEncodeOk | FieldEncodeErr {
  let n: bigint;
  try {
    n = toBigInt(value);
  } catch {
    return {
      ok: false,
      cause: "value_out_of_range",
      detail: "not_integer",
    };
  }
  const max = (1n << bits) - 1n;
  if (n < 0n || n > max) {
    return {
      ok: false,
      cause: "value_out_of_range",
      detail: `range_0_${max.toString()}`,
    };
  }
  const out = new Uint8Array(width);
  let x = n;
  for (let i = 0; i < width; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return { ok: true, bytes: out };
}

function toBigInt(value: InstructionFieldValue): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("not_integer");
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) throw new Error("not_integer");
    return BigInt(value);
  }
  throw new Error("not_integer");
}

function coerceBytes(
  value: InstructionFieldValue,
): FieldEncodeOk | FieldEncodeErr {
  if (value instanceof Uint8Array) {
    return { ok: true, bytes: value };
  }
  if (typeof value === "string") {
    if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
      return {
        ok: false,
        cause: "value_out_of_range",
        detail: "hex_malformed",
      };
    }
    const out = new Uint8Array(value.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    }
    return { ok: true, bytes: out };
  }
  return {
    ok: false,
    cause: "value_out_of_range",
    detail: "bytes_not_hex_or_uint8array",
  };
}

function encodeU32Le(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    throw new Error("u32_len");
  }
  const out = new Uint8Array(4);
  out[0] = n & 0xff;
  out[1] = (n >>> 8) & 0xff;
  out[2] = (n >>> 16) & 0xff;
  out[3] = (n >>> 24) & 0xff;
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
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

/** Convert a manifest sample object into encoder field values. */
export function sampleFieldsFromManifest(
  sample: Record<string, unknown>,
): Record<string, InstructionFieldValue> {
  const out: Record<string, InstructionFieldValue> = {};
  for (const [k, v] of Object.entries(sample)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      throw new Error(`sample_value_unusable:${k}`);
    }
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

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`hex_malformed:${hex}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
