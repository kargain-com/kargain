/**
 * S8-E 9.1 — Devnet mode↔passport bind + encumbrance-register ops door.
 *
 * Plans four actions (bind FixedPrice, bind Ascending, register FixedPrice
 * with fp-ans, register Ascending with asc-ans). State-first: already-done
 * actions are reported and not re-sent; a binding to a foreign passport
 * program refuses by name (never overwrite).
 *
 * Instruction bytes + PDAs come from product owners (encodeSvmInstruction /
 * deriveSvmPda). Program ids from COMMERCIAL_ACTIVE only. Transport is stand
 * web3.js (scripts class) — product Wallet Standard send is out of unit.
 *
 * Dry-run by default. `--live` sends then reads back.
 *
 *   pnpm svm:bind-modes -- \
 *     --eid 40168 \
 *     --rpc <url> \
 *     --authority-keypair <path> \
 *     --payer-keypair <path> \
 *     [--dry-run | --live]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { requireSvmCommercialActive } from "../lib/web3/commercial-active.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import { encodeSvmInstruction } from "../lib/svm/encode-instruction.ts";
import { deriveSvmPda } from "../lib/svm/derive-pda.ts";
import { decodePassportBinding } from "../lib/svm/decode-account-state.ts";
import { systemProgramId } from "../lib/svm/foreign-programs.ts";
import {
  encodeSvmPubkeyBytes,
  svmPubkeyToBytes32,
} from "../lib/web3/protocol-address.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../svm/lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

/** Architect-decided answer seed prefixes for registry entries. */
export const FIXED_PRICE_SEED_PREFIX = "fp-ans" as const;
export const ASCENDING_SEED_PREFIX = "asc-ans" as const;

/** Mirrors `kargain_encumbrance::MAX_SEED_PREFIX_LEN`. */
export const MAX_SEED_PREFIX_LEN = 32;

/** Mirrors `PassportBinding::SPACE`. */
export const PASSPORT_BINDING_SPACE = 41;

/**
 * Byte offset of `encumbrance_sources` in PassportConfig Borsh layout
 * (disc+authority+namespace+eid+endpoint+deposit+staking+gateway+forfeit+next_token_id).
 */
export const PASSPORT_CONFIG_SOURCES_OFFSET = 228;

/** Mirrors `kargain_encumbrance::MAX_ENCUMBRANCE_SOURCES`. */
export const MAX_ENCUMBRANCE_SOURCES = 8;

/** Mirrors passport `resize_config_account` MAX_GROWTH. */
export const MAX_CONFIG_GROWTH = 10_240;

/** PassportConfig and CommerceConfig both use this 8-byte tag on chain. */
export const PASSPORT_CONFIG_DISCRIMINATOR = Buffer.from("kp_cfg\0\0", "utf8");
export const COMMERCE_CONFIG_DISCRIMINATOR = PASSPORT_CONFIG_DISCRIMINATOR;

export type BindModesRefusalCause =
  | "mode_id_missing"
  | "invalid_seed_prefix"
  | "authority_mismatch"
  | "payer_cannot_cover_rent"
  | "binding_foreign_program"
  | "source_prefix_mismatch"
  | "config_cannot_grow"
  | "config_not_found"
  | "config_discriminator_mismatch"
  | "mode_config_not_found"
  | "mode_config_discriminator_mismatch"
  | "readback_mismatch"
  | "encode_failed"
  | "pda_failed";

export const BIND_MODES_REFUSAL_CAUSES: readonly BindModesRefusalCause[] = [
  "mode_id_missing",
  "invalid_seed_prefix",
  "authority_mismatch",
  "payer_cannot_cover_rent",
  "binding_foreign_program",
  "source_prefix_mismatch",
  "config_cannot_grow",
  "config_not_found",
  "config_discriminator_mismatch",
  "mode_config_not_found",
  "mode_config_discriminator_mismatch",
  "readback_mismatch",
  "encode_failed",
  "pda_failed",
] as const;

export class BindModesRefusal extends Error {
  readonly causeName: BindModesRefusalCause;
  constructor(cause: BindModesRefusalCause, detail: string) {
    super(`${cause}: ${detail}`);
    this.name = "BindModesRefusal";
    this.causeName = cause;
  }
}

export type AccountMetaPlan = {
  address: string;
  isSigner: boolean;
  isWritable: boolean;
  role: string;
};

export type BindModesActionKind =
  | "bind_fixed_price"
  | "bind_ascending"
  | "register_fixed_price"
  | "register_ascending";

export type PlannedBindModesAction = {
  kind: BindModesActionKind;
  status: "planned";
  instruction: string;
  programId: string;
  data: Uint8Array;
  accounts: AccountMetaPlan[];
  /** Account whose size changes (binding PDA or passport config). */
  sizeAccount: string;
  sizeBefore: number;
  sizeAfter: number;
  rentTopUpLamports: number;
};

export type AlreadyDoneBindModesAction = {
  kind: BindModesActionKind;
  status: "already_done";
  detail: string;
};

export type BindModesActionOutcome =
  | PlannedBindModesAction
  | AlreadyDoneBindModesAction;

export type EncumbranceSourceParsed = {
  programId: string;
  seedPrefix: string;
  programIdBytes: Uint8Array;
  seedPrefixBytes: Uint8Array;
};

export type BindModesChainState = {
  passportProgramId: string;
  fixedPriceProgramId: string;
  ascendingProgramId: string;
  authorityPubkey: string;
  payerPubkey: string;
  systemProgramId: string;
  passportConfigAddress: string;
  fixedPriceConfigAddress: string;
  ascendingConfigAddress: string;
  fixedPriceBindingAddress: string;
  ascendingBindingAddress: string;
  passportConfig: { data: Uint8Array; lamports: number };
  fixedPriceConfig: { data: Uint8Array; lamports: number };
  ascendingConfig: { data: Uint8Array; lamports: number };
  fixedPriceBinding: { data: Uint8Array } | null;
  ascendingBinding: { data: Uint8Array } | null;
  rentExempt: (dataLen: number) => number;
  payerBalanceLamports: number;
};

export type BindModesPlanOk = {
  ok: true;
  actions: BindModesActionOutcome[];
  planned: PlannedBindModesAction[];
  totalRentTopUpLamports: number;
  payerBalanceLamports: number;
  sources: EncumbranceSourceParsed[];
};

export type BindModesPlanErr = {
  ok: false;
  cause: BindModesRefusalCause;
  detail: string;
};

export type BindModesPlanResult = BindModesPlanOk | BindModesPlanErr;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readU32Le(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}

function writeU32Le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = n & 0xff;
  out[1] = (n >>> 8) & 0xff;
  out[2] = (n >>> 16) & 0xff;
  out[3] = (n >>> 24) & 0xff;
  return out;
}

function hexToBytes32(hex: `0x${string}`): Uint8Array {
  const body = hex.slice(2);
  if (body.length !== 64) {
    throw new Error(`hex_not_32_bytes:${body.length}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Registry base58 program id → 32-byte pubkey for encoder fields. */
export function programIdToBytes(base58: string): Uint8Array {
  return hexToBytes32(svmPubkeyToBytes32(base58));
}

export function requireValidSeedPrefix(prefix: string): void {
  const bytes = new TextEncoder().encode(prefix);
  if (bytes.length === 0 || bytes.length > MAX_SEED_PREFIX_LEN) {
    throw new BindModesRefusal(
      "invalid_seed_prefix",
      `len ${bytes.length} (empty or >${MAX_SEED_PREFIX_LEN})`,
    );
  }
}

/**
 * Ops-local PassportConfig encumbrance_sources walk. Product decode stays
 * partial (remainder_unmodelled) — this door owns the registry list read.
 */
export function parsePassportConfigSources(
  data: Uint8Array,
): EncumbranceSourceParsed[] {
  if (data.length < PASSPORT_CONFIG_SOURCES_OFFSET + 4 + 1) {
    throw new BindModesRefusal(
      "config_cannot_grow",
      `config too short for sources+bump: ${data.length}`,
    );
  }
  let offset = PASSPORT_CONFIG_SOURCES_OFFSET;
  const count = readU32Le(data, offset);
  offset += 4;
  const sources: EncumbranceSourceParsed[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 32 + 4 > data.length) {
      throw new BindModesRefusal(
        "config_cannot_grow",
        `truncated source entry at index ${i}`,
      );
    }
    const programIdBytes = data.subarray(offset, offset + 32);
    offset += 32;
    const prefixLen = readU32Le(data, offset);
    offset += 4;
    if (offset + prefixLen > data.length) {
      throw new BindModesRefusal(
        "config_cannot_grow",
        `truncated seed_prefix at index ${i}`,
      );
    }
    const seedPrefixBytes = data.subarray(offset, offset + prefixLen);
    offset += prefixLen;
    sources.push({
      programId: encodeSvmPubkeyBytes(programIdBytes),
      seedPrefix: new TextDecoder().decode(seedPrefixBytes),
      programIdBytes: Uint8Array.from(programIdBytes),
      seedPrefixBytes: Uint8Array.from(seedPrefixBytes),
    });
  }
  if (offset + 1 !== data.length) {
    // Allow trailing only if bump is last byte; refuse otherwise.
    if (offset + 1 > data.length) {
      throw new BindModesRefusal(
        "config_cannot_grow",
        `missing bump after sources (offset ${offset}, len ${data.length})`,
      );
    }
  }
  return sources;
}

export function encodePassportConfigWithSources(
  currentData: Uint8Array,
  sources: readonly {
    programIdBytes: Uint8Array;
    seedPrefixBytes: Uint8Array;
  }[],
): Uint8Array {
  const prefix = currentData.subarray(0, PASSPORT_CONFIG_SOURCES_OFFSET);
  const bump = currentData[currentData.length - 1]!;
  const parts: Uint8Array[] = [Uint8Array.from(prefix), writeU32Le(sources.length)];
  for (const s of sources) {
    parts.push(s.programIdBytes, writeU32Le(s.seedPrefixBytes.length), s.seedPrefixBytes);
  }
  parts.push(Uint8Array.of(bump));
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

function authorityBytesFromConfig(data: Uint8Array): Uint8Array {
  return data.subarray(8, 40);
}

function bindingPassportProgram(
  data: Uint8Array | null,
): { status: "absent" } | { status: "bound"; passportProgram: string } {
  if (data == null || data.length === 0) {
    return { status: "absent" };
  }
  const decoded = decodePassportBinding(data);
  if (!decoded.ok) {
    return { status: "absent" };
  }
  return { status: "bound", passportProgram: decoded.value.passportProgram };
}

function findSource(
  sources: readonly EncumbranceSourceParsed[],
  programId: string,
): EncumbranceSourceParsed | undefined {
  return sources.find((s) => s.programId === programId);
}

function meta(
  address: string,
  isSigner: boolean,
  isWritable: boolean,
  role: string,
): AccountMetaPlan {
  return { address, isSigner, isWritable, role };
}

function encodeOrRefuse(
  program: string,
  variant: string,
  fields: Record<string, string | number | boolean | Uint8Array>,
): Uint8Array {
  const encoded = encodeSvmInstruction({ program, variant, fields });
  if (!encoded.ok) {
    throw new BindModesRefusal(
      "encode_failed",
      `${encoded.cause}:${encoded.detail}`,
    );
  }
  return encoded.data;
}

/**
 * Pure planner — fixtures inject chain state + rent; no RPC.
 * Callers must have already derived PDA addresses into `state`.
 */
export function planBindModes(state: BindModesChainState): BindModesPlanResult {
  try {
    requireValidSeedPrefix(FIXED_PRICE_SEED_PREFIX);
    requireValidSeedPrefix(ASCENDING_SEED_PREFIX);

    const cfg = state.passportConfig.data;
    if (
      cfg.length < 8 ||
      !bytesEqual(cfg.subarray(0, 8), PASSPORT_CONFIG_DISCRIMINATOR)
    ) {
      return {
        ok: false,
        cause: "config_discriminator_mismatch",
        detail: "passport config discriminator",
      };
    }
    for (const [label, modeCfg] of [
      ["fixed_price", state.fixedPriceConfig.data],
      ["ascending", state.ascendingConfig.data],
    ] as const) {
      if (
        modeCfg.length < 40 ||
        !bytesEqual(modeCfg.subarray(0, 8), COMMERCE_CONFIG_DISCRIMINATOR)
      ) {
        return {
          ok: false,
          cause: "mode_config_discriminator_mismatch",
          detail: label,
        };
      }
    }

    const authorityLocal = programIdToBytes(state.authorityPubkey);
    const passportAuth = authorityBytesFromConfig(cfg);
    if (!bytesEqual(passportAuth, authorityLocal)) {
      return {
        ok: false,
        cause: "authority_mismatch",
        detail: "passport config authority",
      };
    }
    for (const [label, modeCfg] of [
      ["fixed_price", state.fixedPriceConfig.data],
      ["ascending", state.ascendingConfig.data],
    ] as const) {
      if (!bytesEqual(authorityBytesFromConfig(modeCfg), authorityLocal)) {
        return {
          ok: false,
          cause: "authority_mismatch",
          detail: `${label} commerce config authority`,
        };
      }
    }

    const sources = parsePassportConfigSources(cfg);
    const actions: BindModesActionOutcome[] = [];
    const planned: PlannedBindModesAction[] = [];

    const bindSpecs: {
      kind: "bind_fixed_price" | "bind_ascending";
      modeProgramId: string;
      modeConfigAddress: string;
      bindingAddress: string;
      bindingData: Uint8Array | null;
      encodeProgram: "kar-fixed-price" | "kar-ascending";
    }[] = [
      {
        kind: "bind_fixed_price",
        modeProgramId: state.fixedPriceProgramId,
        modeConfigAddress: state.fixedPriceConfigAddress,
        bindingAddress: state.fixedPriceBindingAddress,
        bindingData: state.fixedPriceBinding?.data ?? null,
        encodeProgram: "kar-fixed-price",
      },
      {
        kind: "bind_ascending",
        modeProgramId: state.ascendingProgramId,
        modeConfigAddress: state.ascendingConfigAddress,
        bindingAddress: state.ascendingBindingAddress,
        bindingData: state.ascendingBinding?.data ?? null,
        encodeProgram: "kar-ascending",
      },
    ];

    for (const spec of bindSpecs) {
      const bound = bindingPassportProgram(spec.bindingData);
      if (bound.status === "bound") {
        if (bound.passportProgram !== state.passportProgramId) {
          return {
            ok: false,
            cause: "binding_foreign_program",
            detail: `${spec.kind}: bound to ${bound.passportProgram}, expected ${state.passportProgramId}`,
          };
        }
        actions.push({
          kind: spec.kind,
          status: "already_done",
          detail: `binding ${spec.bindingAddress} → ${bound.passportProgram}`,
        });
        continue;
      }

      const data = encodeOrRefuse(spec.encodeProgram, "BindPassportProgram", {});
      const rentTopUp = state.rentExempt(PASSPORT_BINDING_SPACE);
      const action: PlannedBindModesAction = {
        kind: spec.kind,
        status: "planned",
        instruction: `${spec.encodeProgram}::BindPassportProgram`,
        programId: spec.modeProgramId,
        data,
        accounts: [
          meta(state.authorityPubkey, true, false, "authority"),
          meta(spec.modeConfigAddress, false, false, "mode_config"),
          meta(spec.bindingAddress, false, true, "binding"),
          meta(state.passportProgramId, false, false, "passport_program"),
          meta(state.systemProgramId, false, false, "system"),
          meta(state.payerPubkey, true, true, "payer"),
        ],
        sizeAccount: spec.bindingAddress,
        sizeBefore: 0,
        sizeAfter: PASSPORT_BINDING_SPACE,
        rentTopUpLamports: rentTopUp,
      };
      actions.push(action);
      planned.push(action);
    }

    const registerSpecs: {
      kind: "register_fixed_price" | "register_ascending";
      modeProgramId: string;
      seedPrefix: typeof FIXED_PRICE_SEED_PREFIX | typeof ASCENDING_SEED_PREFIX;
    }[] = [
      {
        kind: "register_fixed_price",
        modeProgramId: state.fixedPriceProgramId,
        seedPrefix: FIXED_PRICE_SEED_PREFIX,
      },
      {
        kind: "register_ascending",
        modeProgramId: state.ascendingProgramId,
        seedPrefix: ASCENDING_SEED_PREFIX,
      },
    ];

    // Track cumulative planned sources for sequential size math.
    let workingSources: {
      programIdBytes: Uint8Array;
      seedPrefixBytes: Uint8Array;
    }[] = sources.map((s) => ({
      programIdBytes: s.programIdBytes,
      seedPrefixBytes: s.seedPrefixBytes,
    }));
    let workingConfigLamports = state.passportConfig.lamports;
    let workingConfigLen = cfg.length;

    for (const spec of registerSpecs) {
      const existing = findSource(sources, spec.modeProgramId);
      if (existing != null) {
        if (existing.seedPrefix !== spec.seedPrefix) {
          return {
            ok: false,
            cause: "source_prefix_mismatch",
            detail: `${spec.kind}: on-chain prefix ${JSON.stringify(existing.seedPrefix)}, expected ${spec.seedPrefix}`,
          };
        }
        actions.push({
          kind: spec.kind,
          status: "already_done",
          detail: `source ${spec.modeProgramId} prefix ${spec.seedPrefix}`,
        });
        continue;
      }

      if (workingSources.length >= MAX_ENCUMBRANCE_SOURCES) {
        return {
          ok: false,
          cause: "config_cannot_grow",
          detail: `encumbrance_sources already at max ${MAX_ENCUMBRANCE_SOURCES}`,
        };
      }

      const seedPrefixBytes = new TextEncoder().encode(spec.seedPrefix);
      const nextSources = [
        ...workingSources,
        {
          programIdBytes: programIdToBytes(spec.modeProgramId),
          seedPrefixBytes,
        },
      ];
      const encodedConfig = encodePassportConfigWithSources(cfg, nextSources);
      const growth = encodedConfig.length - workingConfigLen;
      if (growth > MAX_CONFIG_GROWTH) {
        return {
          ok: false,
          cause: "config_cannot_grow",
          detail: `growth ${growth} > ${MAX_CONFIG_GROWTH}`,
        };
      }

      const newMinimum = state.rentExempt(encodedConfig.length);
      const rentTopUp = Math.max(0, newMinimum - workingConfigLamports);

      const data = encodeOrRefuse("kar-passport", "AddEncumbranceSource", {
        program_id: programIdToBytes(spec.modeProgramId),
        seed_prefix: seedPrefixBytes,
      });

      const action: PlannedBindModesAction = {
        kind: spec.kind,
        status: "planned",
        instruction: "kar-passport::AddEncumbranceSource",
        programId: state.passportProgramId,
        data,
        accounts: [
          meta(state.passportConfigAddress, false, true, "passport_config"),
          meta(state.authorityPubkey, true, false, "authority"),
          meta(state.payerPubkey, true, true, "payer"),
          meta(state.systemProgramId, false, false, "system"),
        ],
        sizeAccount: state.passportConfigAddress,
        sizeBefore: workingConfigLen,
        sizeAfter: encodedConfig.length,
        rentTopUpLamports: rentTopUp,
      };
      actions.push(action);
      planned.push(action);

      workingSources = nextSources;
      workingConfigLen = encodedConfig.length;
      workingConfigLamports += rentTopUp;
    }

    const totalRentTopUpLamports = planned.reduce(
      (sum, a) => sum + a.rentTopUpLamports,
      0,
    );
    if (state.payerBalanceLamports < totalRentTopUpLamports) {
      return {
        ok: false,
        cause: "payer_cannot_cover_rent",
        detail: `balance ${state.payerBalanceLamports} < total rent ${totalRentTopUpLamports}`,
      };
    }

    return {
      ok: true,
      actions,
      planned,
      totalRentTopUpLamports,
      payerBalanceLamports: state.payerBalanceLamports,
      sources,
    };
  } catch (err) {
    if (err instanceof BindModesRefusal) {
      return { ok: false, cause: err.causeName, detail: err.message };
    }
    throw err;
  }
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function loadKp(p: string): InstanceType<typeof Keypair> {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function formatAccounts(accounts: AccountMetaPlan[]): string {
  return accounts
    .map(
      (a) =>
        `    ${a.role.padEnd(18)} ${a.address}  signer=${a.isSigner} writable=${a.isWritable}`,
    )
    .join("\n");
}

export function formatBindModesPlan(plan: BindModesPlanOk): string {
  const lines: string[] = [];
  lines.push("svm-devnet-bind-modes plan");
  lines.push(`sources_on_chain ${plan.sources.length}`);
  for (const s of plan.sources) {
    lines.push(`  source ${s.programId} prefix=${JSON.stringify(s.seedPrefix)}`);
  }
  for (const action of plan.actions) {
    lines.push("");
    if (action.status === "already_done") {
      lines.push(`[already_done] ${action.kind}`);
      lines.push(`  ${action.detail}`);
      continue;
    }
    lines.push(`[planned] ${action.kind}`);
    lines.push(`  instruction ${action.instruction}`);
    lines.push(`  program_id ${action.programId}`);
    lines.push(`  accounts`);
    lines.push(formatAccounts(action.accounts));
    lines.push(
      `  size ${action.sizeAccount}: ${action.sizeBefore} → ${action.sizeAfter} bytes`,
    );
    lines.push(`  rent_top_up_lamports ${action.rentTopUpLamports}`);
  }
  lines.push("");
  lines.push(`total_rent_top_up_lamports ${plan.totalRentTopUpLamports}`);
  lines.push(`payer_balance_lamports ${plan.payerBalanceLamports}`);
  lines.push(
    plan.payerBalanceLamports >= plan.totalRentTopUpLamports
      ? "payer_covers_rent yes"
      : "payer_covers_rent no",
  );
  return lines.join("\n");
}

async function deriveRequiredPdas(stack: {
  karPassport: string;
  fixedPriceConsignment: string;
  ascendingConsignment: string;
}): Promise<{
  passportConfig: string;
  fixedPriceConfig: string;
  ascendingConfig: string;
  fixedPriceBinding: string;
  ascendingBinding: string;
}> {
  const results = await Promise.all([
    deriveSvmPda({
      recipe: "kar-passport/config",
      programId: stack.karPassport,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/config",
      programId: stack.fixedPriceConsignment,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/config",
      programId: stack.ascendingConsignment,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: stack.fixedPriceConsignment,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: stack.ascendingConsignment,
    }),
  ]);
  const labels = [
    "passport_config",
    "fixed_price_config",
    "ascending_config",
    "fixed_price_binding",
    "ascending_binding",
  ] as const;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (!r.ok) {
      throw new BindModesRefusal(
        "pda_failed",
        `${labels[i]}:${r.cause}:${r.detail}`,
      );
    }
  }
  return {
    passportConfig: results[0]!.ok ? results[0].address : "",
    fixedPriceConfig: results[1]!.ok ? results[1].address : "",
    ascendingConfig: results[2]!.ok ? results[2].address : "",
    fixedPriceBinding: results[3]!.ok ? results[3].address : "",
    ascendingBinding: results[4]!.ok ? results[4].address : "",
  };
}

function requirePassportConfigAccount(
  info: { data: Buffer; lamports: number } | null,
  address: string,
): { data: Uint8Array; lamports: number } {
  if (info == null) {
    throw new BindModesRefusal("config_not_found", address);
  }
  return {
    data: Uint8Array.from(info.data),
    lamports: info.lamports,
  };
}

function requireModeConfigAccount(
  info: { data: Buffer; lamports: number } | null,
  label: string,
): { data: Uint8Array; lamports: number } {
  if (info == null) {
    throw new BindModesRefusal(
      "mode_config_not_found",
      `${label} — CommerceConfig PDA absent (InitConfig required before bind)`,
    );
  }
  return {
    data: Uint8Array.from(info.data),
    lamports: info.lamports,
  };
}

async function assertLiveReadback(args: {
  connection: InstanceType<typeof Connection>;
  passportProgramId: string;
  fixedPriceProgramId: string;
  ascendingProgramId: string;
  fixedPriceBindingAddress: string;
  ascendingBindingAddress: string;
  passportConfigAddress: string;
}): Promise<void> {
  const [fpBind, ascBind, cfgInfo] = await Promise.all([
    args.connection.getAccountInfo(new PublicKey(args.fixedPriceBindingAddress)),
    args.connection.getAccountInfo(new PublicKey(args.ascendingBindingAddress)),
    args.connection.getAccountInfo(new PublicKey(args.passportConfigAddress)),
  ]);
  for (const [label, info] of [
    ["fixed_price_binding", fpBind],
    ["ascending_binding", ascBind],
  ] as const) {
    if (info == null || info.data.length === 0) {
      throw new BindModesRefusal(
        "readback_mismatch",
        `${label} absent after live send`,
      );
    }
    const decoded = decodePassportBinding(Uint8Array.from(info.data));
    if (!decoded.ok || decoded.value.passportProgram !== args.passportProgramId) {
      throw new BindModesRefusal(
        "readback_mismatch",
        `${label} expected passport ${args.passportProgramId}, got ${
          decoded.ok ? decoded.value.passportProgram : decoded.cause
        }`,
      );
    }
  }
  if (cfgInfo == null) {
    throw new BindModesRefusal("readback_mismatch", "passport config absent");
  }
  const sources = parsePassportConfigSources(Uint8Array.from(cfgInfo.data));
  const fp = findSource(sources, args.fixedPriceProgramId);
  const asc = findSource(sources, args.ascendingProgramId);
  if (fp == null || fp.seedPrefix !== FIXED_PRICE_SEED_PREFIX) {
    throw new BindModesRefusal(
      "readback_mismatch",
      `fixed_price source missing or prefix != ${FIXED_PRICE_SEED_PREFIX}`,
    );
  }
  if (asc == null || asc.seedPrefix !== ASCENDING_SEED_PREFIX) {
    throw new BindModesRefusal(
      "readback_mismatch",
      `ascending source missing or prefix != ${ASCENDING_SEED_PREFIX}`,
    );
  }
  // Registry order: FixedPrice then Ascending among the two mode entries.
  const modeEntries = sources.filter(
    (s) =>
      s.programId === args.fixedPriceProgramId ||
      s.programId === args.ascendingProgramId,
  );
  if (
    modeEntries.length < 2 ||
    modeEntries[0]!.programId !== args.fixedPriceProgramId ||
    modeEntries[1]!.programId !== args.ascendingProgramId
  ) {
    throw new BindModesRefusal(
      "readback_mismatch",
      `mode sources not in registry order (fp then asc): ${modeEntries
        .map((s) => s.programId)
        .join(",")}`,
    );
  }
}

async function main(): Promise<void> {
  const eid = Number(arg("--eid"));
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new Error(`invalid --eid ${eid}`);
  }
  const rpc = arg("--rpc");
  const authority = loadKp(arg("--authority-keypair"));
  const payer = loadKp(arg("--payer-keypair"));
  const live = hasFlag("--live");
  // Dry-run by default; --dry-run is an explicit affirm.
  const dryRun = !live;

  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);
  const fixedPriceProgramId = stack.fixedPriceConsignment;
  const ascendingProgramId = stack.ascendingConsignment;
  if (fixedPriceProgramId == null || fixedPriceProgramId.length === 0) {
    throw new BindModesRefusal(
      "mode_id_missing",
      "fixedPriceConsignment absent from COMMERCIAL_ACTIVE",
    );
  }
  if (ascendingProgramId == null || ascendingProgramId.length === 0) {
    throw new BindModesRefusal(
      "mode_id_missing",
      "ascendingConsignment absent from COMMERCIAL_ACTIVE",
    );
  }

  requireValidSeedPrefix(FIXED_PRICE_SEED_PREFIX);
  requireValidSeedPrefix(ASCENDING_SEED_PREFIX);

  const pdas = await deriveRequiredPdas({
    karPassport: stack.karPassport,
    fixedPriceConsignment: fixedPriceProgramId,
    ascendingConsignment: ascendingProgramId,
  });

  const connection = new Connection(rpc, "confirmed");
  const [
    passportCfgInfo,
    fpCfgInfo,
    ascCfgInfo,
    fpBindInfo,
    ascBindInfo,
    payerBal,
    bindingRent,
  ] = await Promise.all([
    connection.getAccountInfo(new PublicKey(pdas.passportConfig)),
    connection.getAccountInfo(new PublicKey(pdas.fixedPriceConfig)),
    connection.getAccountInfo(new PublicKey(pdas.ascendingConfig)),
    connection.getAccountInfo(new PublicKey(pdas.fixedPriceBinding)),
    connection.getAccountInfo(new PublicKey(pdas.ascendingBinding)),
    connection.getBalance(payer.publicKey),
    connection.getMinimumBalanceForRentExemption(PASSPORT_BINDING_SPACE),
  ]);

  const passportConfig = requirePassportConfigAccount(
    passportCfgInfo,
    pdas.passportConfig,
  );
  const fixedPriceConfig = requireModeConfigAccount(
    fpCfgInfo,
    `fixed_price ${pdas.fixedPriceConfig}`,
  );
  const ascendingConfig = requireModeConfigAccount(
    ascCfgInfo,
    `ascending ${pdas.ascendingConfig}`,
  );

  // Cache rent exemptions we need; register sizes vary — fetch per size.
  const rentCache = new Map<number, number>([[PASSPORT_BINDING_SPACE, bindingRent]]);
  const rentExempt = (dataLen: number): number => {
    const hit = rentCache.get(dataLen);
    if (hit != null) return hit;
    // Synchronous path for planner: we pre-fetch below when size unknown.
    throw new Error(`rent_cache_miss:${dataLen}`);
  };

  // First plan with a placeholder rent for register sizes, then refine.
  // Pre-compute possible new config lengths by dry-walking sources.
  const provisionalSources = parsePassportConfigSources(passportConfig.data);
  const candidateLens = new Set<number>([passportConfig.data.length]);
  let probeSources = provisionalSources.map((s) => ({
    programIdBytes: s.programIdBytes,
    seedPrefixBytes: s.seedPrefixBytes,
  }));
  for (const [modeId, prefix] of [
    [fixedPriceProgramId, FIXED_PRICE_SEED_PREFIX],
    [ascendingProgramId, ASCENDING_SEED_PREFIX],
  ] as const) {
    if (findSource(provisionalSources, modeId) == null) {
      probeSources = [
        ...probeSources,
        {
          programIdBytes: programIdToBytes(modeId),
          seedPrefixBytes: new TextEncoder().encode(prefix),
        },
      ];
      candidateLens.add(
        encodePassportConfigWithSources(passportConfig.data, probeSources).length,
      );
    }
  }
  for (const len of candidateLens) {
    if (!rentCache.has(len)) {
      rentCache.set(
        len,
        await connection.getMinimumBalanceForRentExemption(len),
      );
    }
  }

  const state: BindModesChainState = {
    passportProgramId: stack.karPassport,
    fixedPriceProgramId,
    ascendingProgramId,
    authorityPubkey: authority.publicKey.toBase58(),
    payerPubkey: payer.publicKey.toBase58(),
    systemProgramId: systemProgramId(),
    passportConfigAddress: pdas.passportConfig,
    fixedPriceConfigAddress: pdas.fixedPriceConfig,
    ascendingConfigAddress: pdas.ascendingConfig,
    fixedPriceBindingAddress: pdas.fixedPriceBinding,
    ascendingBindingAddress: pdas.ascendingBinding,
    passportConfig,
    fixedPriceConfig,
    ascendingConfig,
    fixedPriceBinding:
      fpBindInfo == null ? null : { data: Uint8Array.from(fpBindInfo.data) },
    ascendingBinding:
      ascBindInfo == null ? null : { data: Uint8Array.from(ascBindInfo.data) },
    rentExempt,
    payerBalanceLamports: payerBal,
  };

  const plan = planBindModes(state);
  if (!plan.ok) {
    throw new BindModesRefusal(plan.cause, plan.detail);
  }

  console.log(`eid ${eid}`);
  console.log(`namespace ${namespace}`);
  console.log(`passport ${stack.karPassport}`);
  console.log(`fixed_price ${fixedPriceProgramId}`);
  console.log(`ascending ${ascendingProgramId}`);
  console.log(`passport_config ${pdas.passportConfig}`);
  console.log(`fixed_price_config ${pdas.fixedPriceConfig}`);
  console.log(`ascending_config ${pdas.ascendingConfig}`);
  console.log(`fixed_price_binding ${pdas.fixedPriceBinding}`);
  console.log(`ascending_binding ${pdas.ascendingBinding}`);
  console.log(formatBindModesPlan(plan));

  if (dryRun) {
    console.log("dry_run ok — not sent");
    return;
  }

  const signersFor = (accounts: AccountMetaPlan[]) => {
    const out: InstanceType<typeof Keypair>[] = [];
    const seen = new Set<string>();
    for (const a of accounts) {
      if (!a.isSigner) continue;
      if (a.address === authority.publicKey.toBase58() && !seen.has("authority")) {
        out.push(authority);
        seen.add("authority");
      } else if (a.address === payer.publicKey.toBase58() && !seen.has("payer")) {
        if (payer.publicKey.equals(authority.publicKey)) {
          // already added as authority
          seen.add("payer");
        } else {
          out.push(payer);
          seen.add("payer");
        }
      }
    }
    return out;
  };

  for (const action of plan.planned) {
    const ix = new TransactionInstruction({
      programId: new PublicKey(action.programId),
      keys: action.accounts.map((a) => ({
        pubkey: new PublicKey(a.address),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
      data: Buffer.from(action.data),
    });
    const signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      signersFor(action.accounts),
      { commitment: "confirmed" },
    );
    console.log(`sent ${action.kind} signature ${signature}`);
  }

  await assertLiveReadback({
    connection,
    passportProgramId: stack.karPassport,
    fixedPriceProgramId,
    ascendingProgramId,
    fixedPriceBindingAddress: pdas.fixedPriceBinding,
    ascendingBindingAddress: pdas.ascendingBinding,
    passportConfigAddress: pdas.passportConfig,
  });
  console.log("readback ok — both bindings + both sources with expected prefixes");
}

const invokedAsCli =
  process.argv[1] != null &&
  /svm-devnet-bind-modes\.(ts|js)$/.test(path.resolve(process.argv[1]));

if (invokedAsCli) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
