/**
 * Sole product owner for commercial SVM PDA derivation.
 *
 * Recipe layouts + goldens come from Rust `find_program_address` via the
 * committed `svm/crates/kargain-ix-wire/pda.manifest.json`. This module never
 * authors goldens. Async only — `@solana/kit` has no sync PDA primitive.
 *
 * Two doors, typed by job:
 * - {@link deriveSvmPda} — product entry: recipe id + registry program id only.
 * - {@link deriveSvmPdaLayout} — golden/plant seam: explicit layout + synthetic
 *   program id only. Not a product path.
 *
 * Import derivation from `@solana/kit` only (never `@solana/addresses`,
 * `@solana/web3.js`, or `scripts/`).
 */

import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";

import pdaManifest from "../../svm/crates/kargain-ix-wire/pda.manifest.json" with {
  type: "json",
};
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";

export type PdaDynamicDecl = {
  name: string;
  encoding: string;
};

export type PdaManifestRecipe = {
  owner: string;
  id: string;
  seedTagHex: string;
  dynamics: PdaDynamicDecl[];
  sample: Record<string, unknown>;
  goldenAddress: string;
  goldenBump: number;
};

export type PdaManifest = {
  version: number;
  syntheticProgramIdHex: string;
  recipes: PdaManifestRecipe[];
};

export type DeriveSvmPdaCause =
  | "unknown_recipe"
  | "missing_seed"
  | "invalid_seed"
  | "unregistered_program"
  | "not_synthetic_program";

export type DeriveSvmPdaOk = {
  ok: true;
  address: Address;
  bump: number;
  recipe: PdaManifestRecipe;
};

export type DeriveSvmPdaErr = {
  ok: false;
  cause: DeriveSvmPdaCause;
  detail: string;
};

export type DeriveSvmPdaResult = DeriveSvmPdaOk | DeriveSvmPdaErr;

export type PdaSeedValue = string | number | Uint8Array;

const MANIFEST = pdaManifest as PdaManifest;

const BY_ID = new Map<string, PdaManifestRecipe>(
  MANIFEST.recipes.map((r) => [r.id, r]),
);

const ADDRESS_ENCODER = getAddressEncoder();

const SYNTHETIC_PROGRAM_ID: Address = getAddressDecoder().decode(
  hexToBytesExact(MANIFEST.syntheticProgramIdHex, 32),
);

/** Six commercial SVM program fields — derivation authorities for product recipes. */
const SVM_PROGRAM_FIELDS = [
  "karPassport",
  "karProPass",
  "karProStaking",
  "bridgeGateway",
  "fixedPriceConsignment",
  "ascendingConsignment",
] as const satisfies readonly (keyof SvmCommercialActiveStack)[];

function commercialSvmProgramIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const namespace of commercialSvmNamespaceIds()) {
    const stack = requireSvmCommercialActive(namespace);
    for (const field of SVM_PROGRAM_FIELDS) {
      const value = stack[field];
      if (typeof value === "string" && value.length > 0) {
        ids.add(value);
      }
    }
  }
  return ids;
}

const REGISTERED_PROGRAM_IDS = commercialSvmProgramIds();

export function pdaManifestRecipes(): readonly PdaManifestRecipe[] {
  return MANIFEST.recipes;
}

export function pdaSyntheticProgramId(): Address {
  return SYNTHETIC_PROGRAM_ID;
}

export function pdaSyntheticProgramIdHex(): string {
  return MANIFEST.syntheticProgramIdHex;
}

/**
 * Product entry: derive a PDA for a named committed recipe.
 *
 * `programId` must be a commercial SVM program id from `COMMERCIAL_ACTIVE`.
 * The synthetic verification id is refused as `unregistered_program` — product
 * code must not invent a stack that is not deployed.
 */
export async function deriveSvmPda(input: {
  recipe: string;
  programId: string;
  seeds?: Record<string, PdaSeedValue>;
}): Promise<DeriveSvmPdaResult> {
  const recipe = BY_ID.get(input.recipe);
  if (!recipe) {
    return {
      ok: false,
      cause: "unknown_recipe",
      detail: input.recipe,
    };
  }
  if (!REGISTERED_PROGRAM_IDS.has(input.programId)) {
    return {
      ok: false,
      cause: "unregistered_program",
      detail: input.programId,
    };
  }
  return deriveCore({
    recipe,
    programId: input.programId,
    seeds: input.seeds,
  });
}

/**
 * Golden-verification seam: derive against an explicit layout object.
 *
 * Accepts **only** the committed synthetic program id. A registry (or any
 * other) program id refuses as `not_synthetic_program`. Product call sites use
 * {@link deriveSvmPda}; this seam exists for golden parity and planted controls.
 */
export async function deriveSvmPdaLayout(input: {
  recipe: PdaManifestRecipe;
  programId: string;
  seeds?: Record<string, PdaSeedValue>;
}): Promise<DeriveSvmPdaResult> {
  if (input.programId !== SYNTHETIC_PROGRAM_ID) {
    return {
      ok: false,
      cause: "not_synthetic_program",
      detail: input.programId,
    };
  }
  return deriveCore({
    recipe: input.recipe,
    programId: input.programId,
    seeds: input.seeds,
  });
}

/** Shared seed encode + kit call — not exported. */
async function deriveCore(input: {
  recipe: PdaManifestRecipe;
  programId: string;
  seeds?: Record<string, PdaSeedValue>;
}): Promise<DeriveSvmPdaResult> {
  let programAddress: Address;
  try {
    programAddress = address(input.programId);
  } catch {
    return {
      ok: false,
      cause: "unregistered_program",
      detail: `malformed:${input.programId}`,
    };
  }

  const recipe = input.recipe;
  const seedParts: Uint8Array[] = [hexToBytesExact(recipe.seedTagHex)];
  const provided = input.seeds ?? {};

  for (const dyn of recipe.dynamics) {
    if (!(dyn.name in provided)) {
      return {
        ok: false,
        cause: "missing_seed",
        detail: dyn.name,
      };
    }
    const encoded = encodeDynamicSeed(dyn.encoding, provided[dyn.name]);
    if (!encoded.ok) {
      return {
        ok: false,
        cause: "invalid_seed",
        detail: `${dyn.name}:${encoded.detail}`,
      };
    }
    seedParts.push(encoded.bytes);
  }

  const [pda, bump] = await getProgramDerivedAddress({
    programAddress,
    seeds: seedParts,
  });

  return {
    ok: true,
    address: pda,
    bump,
    recipe,
  };
}

type EncodeOk = { ok: true; bytes: Uint8Array };
type EncodeErr = { ok: false; detail: string };

function encodeDynamicSeed(
  encoding: string,
  value: PdaSeedValue,
): EncodeOk | EncodeErr {
  if (encoding === "bytes32") {
    return encodeBytes32(value);
  }
  if (encoding === "u32_le") {
    return encodeU32(value, "le");
  }
  if (encoding === "u32_be") {
    return encodeU32(value, "be");
  }
  return { ok: false, detail: `unsupported_encoding:${encoding}` };
}

function encodeBytes32(value: PdaSeedValue): EncodeOk | EncodeErr {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) {
      return { ok: false, detail: `bytes32_len_${value.length}` };
    }
    return { ok: true, bytes: value };
  }
  if (typeof value === "string") {
    if (/^[0-9a-fA-F]{64}$/.test(value)) {
      return { ok: true, bytes: hexToBytesExact(value, 32) };
    }
    try {
      const a = address(value);
      const bytes = ADDRESS_ENCODER.encode(a);
      return { ok: true, bytes: Uint8Array.from(bytes) };
    } catch {
      return { ok: false, detail: "bytes32_not_hex_or_address" };
    }
  }
  return { ok: false, detail: "bytes32_wrong_type" };
}

function encodeU32(
  value: PdaSeedValue,
  endian: "le" | "be",
): EncodeOk | EncodeErr {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
    n = Number(value);
  } else {
    return { ok: false, detail: "u32_wrong_type" };
  }
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    return { ok: false, detail: "u32_out_of_range" };
  }
  const out = new Uint8Array(4);
  if (endian === "le") {
    out[0] = n & 0xff;
    out[1] = (n >>> 8) & 0xff;
    out[2] = (n >>> 16) & 0xff;
    out[3] = (n >>> 24) & 0xff;
  } else {
    out[0] = (n >>> 24) & 0xff;
    out[1] = (n >>> 16) & 0xff;
    out[2] = (n >>> 8) & 0xff;
    out[3] = n & 0xff;
  }
  return { ok: true, bytes: out };
}

function hexToBytesExact(hex: string, expectedLen?: number): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`hex_malformed:${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (expectedLen !== undefined && out.length !== expectedLen) {
    throw new Error(`hex_len_${out.length}_expected_${expectedLen}`);
  }
  return out;
}

/** Sample dynamics from a manifest recipe → seed map for derivation doors. */
export function sampleSeedsFromManifest(
  recipe: PdaManifestRecipe,
): Record<string, PdaSeedValue> {
  const out: Record<string, PdaSeedValue> = {};
  for (const dyn of recipe.dynamics) {
    const raw = recipe.sample[dyn.name];
    if (dyn.encoding === "bytes32") {
      if (typeof raw !== "string") {
        throw new Error(`sample_bytes32:${recipe.id}:${dyn.name}`);
      }
      out[dyn.name] = raw;
    } else if (dyn.encoding === "u32_le" || dyn.encoding === "u32_be") {
      if (typeof raw !== "number") {
        throw new Error(`sample_u32:${recipe.id}:${dyn.name}`);
      }
      out[dyn.name] = raw;
    } else {
      throw new Error(`sample_encoding:${recipe.id}:${dyn.encoding}`);
    }
  }
  return out;
}
