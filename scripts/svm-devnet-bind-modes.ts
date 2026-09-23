/**
 * S8-E 9.1 / 9.2 — Devnet mode↔passport bind + encumbrance-register ops door.
 *
 * Plans four actions (bind FixedPrice, bind Ascending, register FixedPrice
 * with fp-ans, register Ascending with asc-ans). State-first: already-done
 * actions are reported and not re-sent; a binding to a foreign passport
 * program refuses by name (never overwrite).
 *
 * Instruction bytes + PDAs come from product owners (encodeSvmInstruction /
 * deriveSvmPda). Account bytes decode through decode-account-state owners.
 * Program ids from COMMERCIAL_ACTIVE only. Transport is stand web3.js
 * (scripts class) — product Wallet Standard send is out of unit.
 *
 * Dry-run by default prints measured on-chain readback (9.2) then the plan.
 * `--live` sends then reads back.
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
import {
  decodeAscendingConfig,
  decodeCommerceConfig,
  decodePassportBinding,
  decodePassportConfig,
  decodePassportState,
  encodePassportConfigWithSources,
  type AscendingConfigDecoded,
  type CommerceConfigDecoded,
  type EncumbranceSourceDecoded,
  type PassportConfigDecoded,
} from "../lib/svm/decode-account-state.ts";
import { tokenIdFromBytes32 } from "../lib/svm/event-payload-decode.ts";
import { systemProgramId } from "../lib/svm/foreign-programs.ts";
import { svmPubkeyToBytes32 } from "../lib/web3/protocol-address.ts";

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

/** Mirrors `kargain_encumbrance::MAX_ENCUMBRANCE_SOURCES`. */
export const MAX_ENCUMBRANCE_SOURCES = 8;

/** Mirrors passport `resize_config_account` MAX_GROWTH. */
export const MAX_CONFIG_GROWTH = 10_240;

/** Re-export sole reshape owner — scripts must not hand-parse config bytes. */
export { encodePassportConfigWithSources };

/** PassportConfig and FixedPrice CommerceConfig use this 8-byte tag on chain. */
export const PASSPORT_CONFIG_DISCRIMINATOR = Buffer.from("kp_cfg\0\0", "utf8");
export const COMMERCE_CONFIG_DISCRIMINATOR = PASSPORT_CONFIG_DISCRIMINATOR;
/** AscendingConfig discriminator (`kp_ascfg`) — not CommerceConfig. */
export const ASCENDING_CONFIG_DISCRIMINATOR = Buffer.from("kp_ascfg", "utf8");

/** LeaveChain / OpenConsignment intent ordinals (kargain-encumbrance). */
export const INTENT_LEAVE_CHAIN = 0;
export const INTENT_OPEN_CONSIGNMENT = 1;

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

export type EncumbranceSourceParsed = EncumbranceSourceDecoded;

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

function passportConfigPlanCause(
  cause: string,
): Extract<
  BindModesRefusalCause,
  "config_discriminator_mismatch" | "config_cannot_grow"
> {
  if (cause === "discriminator_mismatch") {
    return "config_discriminator_mismatch";
  }
  return "config_cannot_grow";
}

function modeConfigPlanCause(
  cause: string,
): Extract<
  BindModesRefusalCause,
  "mode_config_discriminator_mismatch" | "mode_config_not_found"
> {
  if (cause === "discriminator_mismatch") {
    return "mode_config_discriminator_mismatch";
  }
  return "mode_config_not_found";
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
    const passportDecoded = decodePassportConfig(cfg);
    if (!passportDecoded.ok) {
      return {
        ok: false,
        cause: passportConfigPlanCause(passportDecoded.cause),
        detail: `passport config:${passportDecoded.cause}:${passportDecoded.detail}`,
      };
    }
    const fpDecoded = decodeCommerceConfig(state.fixedPriceConfig.data);
    if (!fpDecoded.ok) {
      return {
        ok: false,
        cause: modeConfigPlanCause(fpDecoded.cause),
        detail: `fixed_price:${fpDecoded.cause}:${fpDecoded.detail}`,
      };
    }
    const ascDecoded = decodeAscendingConfig(state.ascendingConfig.data);
    if (!ascDecoded.ok) {
      return {
        ok: false,
        cause: modeConfigPlanCause(ascDecoded.cause),
        detail: `ascending:${ascDecoded.cause}:${ascDecoded.detail}`,
      };
    }

    if (passportDecoded.value.authority !== state.authorityPubkey) {
      return {
        ok: false,
        cause: "authority_mismatch",
        detail: "passport config authority",
      };
    }
    if (fpDecoded.value.authority !== state.authorityPubkey) {
      return {
        ok: false,
        cause: "authority_mismatch",
        detail: "fixed_price commerce config authority",
      };
    }
    if (ascDecoded.value.authority !== state.authorityPubkey) {
      return {
        ok: false,
        cause: "authority_mismatch",
        detail: "ascending commerce config authority",
      };
    }

    const sources = passportDecoded.value.encumbranceSources;
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

function priorTokenIdBytes(nextTokenId: Uint8Array): Uint8Array | null {
  let n = 0n;
  for (const b of nextTokenId) {
    n = (n << 8n) | BigInt(b);
  }
  if (n === 0n) return null;
  const prior = n - 1n;
  const out = new Uint8Array(32);
  let v = prior;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export type MeasuredReadbackInput = {
  fixedPriceConfig: CommerceConfigDecoded;
  ascendingConfig: AscendingConfigDecoded;
  fixedPriceConfigAddress: string;
  ascendingConfigAddress: string;
  fixedPriceConfigSize: number;
  ascendingConfigSize: number;
  passportConfig: PassportConfigDecoded;
  passportConfigAddress: string;
  passportConfigSize: number;
  fixedPriceBinding: {
    passportProgram: string;
    owner: string;
    address: string;
  } | null;
  ascendingBinding: {
    passportProgram: string;
    owner: string;
    address: string;
  } | null;
  sampleTokenId: string | null;
  sampleTokenNote: string;
  answerPdas: {
    modeProgramId: string;
    seedPrefix: string;
    intent: number;
    intentName: string;
    address: string | null;
    recipe: string;
  }[];
};

/**
 * Measured on-chain readback for the ops record — all fields from owning
 * decoders. Lists values that cannot be rotated without a new instruction.
 */
export function formatMeasuredReadback(input: MeasuredReadbackInput): string {
  const lines: string[] = [];
  lines.push("svm-devnet-bind-modes measured_readback");
  lines.push("");
  lines.push(`fixed_price_config ${input.fixedPriceConfigAddress}`);
  lines.push(`  size_bytes ${input.fixedPriceConfigSize}`);
  lines.push(`  discriminator kp_cfg`);
  lines.push(`  authority ${input.fixedPriceConfig.authority}`);
  lines.push(`  platform_recipient ${input.fixedPriceConfig.platformRecipient}`);
  lines.push(`  platform_fee_bps ${input.fixedPriceConfig.platformFeeBps}`);
  lines.push(`  guardian ${input.fixedPriceConfig.guardian}`);
  lines.push(`  paused ${input.fixedPriceConfig.paused}`);
  lines.push(
    `  self_encumbrance_registered_retired ${input.fixedPriceConfig.selfEncumbranceRegisteredRetired}`,
  );
  lines.push("");
  lines.push(`ascending_config ${input.ascendingConfigAddress}`);
  lines.push(`  size_bytes ${input.ascendingConfigSize}`);
  lines.push(`  discriminator kp_ascfg`);
  lines.push(`  authority ${input.ascendingConfig.authority}`);
  lines.push(`  platform_recipient ${input.ascendingConfig.platformRecipient}`);
  lines.push(`  platform_fee_bps ${input.ascendingConfig.platformFeeBps}`);
  lines.push(`  guardian ${input.ascendingConfig.guardian}`);
  lines.push(`  paused ${input.ascendingConfig.paused}`);
  lines.push(
    `  self_encumbrance_registered_retired ${input.ascendingConfig.selfEncumbranceRegisteredRetired}`,
  );
  lines.push(`  staking_program ${input.ascendingConfig.stakingProgram}`);
  lines.push(`  forfeit_recipient ${input.ascendingConfig.forfeitRecipient}`);
  lines.push(`  challenge_bond ${input.ascendingConfig.challengeBond}`);
  lines.push(`  challenge_window ${input.ascendingConfig.challengeWindow}`);
  lines.push(
    `  challenge_configured ${input.ascendingConfig.challengeConfigured}`,
  );
  lines.push("");
  if (input.fixedPriceBinding == null) {
    lines.push("fixed_price_binding absent");
  } else {
    lines.push(`fixed_price_binding ${input.fixedPriceBinding.address}`);
    lines.push(`  owner ${input.fixedPriceBinding.owner}`);
    lines.push(
      `  passport_program ${input.fixedPriceBinding.passportProgram}`,
    );
  }
  if (input.ascendingBinding == null) {
    lines.push("ascending_binding absent");
  } else {
    lines.push(`ascending_binding ${input.ascendingBinding.address}`);
    lines.push(`  owner ${input.ascendingBinding.owner}`);
    lines.push(`  passport_program ${input.ascendingBinding.passportProgram}`);
  }
  lines.push("");
  lines.push(`passport_config ${input.passportConfigAddress}`);
  lines.push(`  size_bytes ${input.passportConfigSize}`);
  lines.push(`  authority ${input.passportConfig.authority}`);
  lines.push(`  namespace ${input.passportConfig.namespace}`);
  lines.push(`  sources_count ${input.passportConfig.encumbranceSources.length}`);
  for (const [i, s] of input.passportConfig.encumbranceSources.entries()) {
    lines.push(
      `  source[${i}] program_id=${s.programId} seed_prefix=${JSON.stringify(s.seedPrefix)}`,
    );
  }
  lines.push("");
  if (input.sampleTokenId == null) {
    lines.push(`sample_token unavailable — ${input.sampleTokenNote}`);
  } else {
    lines.push(`sample_token ${input.sampleTokenId}`);
    lines.push(`  note ${input.sampleTokenNote}`);
  }
  for (const a of input.answerPdas) {
    if (a.address == null) {
      lines.push(
        `answer_pda recipe ${a.recipe} mode=${a.modeProgramId} prefix=${a.seedPrefix} intent=${a.intentName}(${a.intent}) — address not derived (${input.sampleTokenNote})`,
      );
    } else {
      lines.push(
        `answer_pda ${a.address} mode=${a.modeProgramId} prefix=${a.seedPrefix} intent=${a.intentName}(${a.intent})`,
      );
    }
  }
  lines.push("");
  lines.push("unsettable_today (missing instruction — InitConfig value is sticky)");
  lines.push(
    "  fixed_price.guardian — needs SetGuardian (crate set_guardian unwired)",
  );
  lines.push(
    "  fixed_price.platform_recipient — needs SetPlatformRecipient",
  );
  lines.push(
    "  fixed_price.platform_fee_bps — InitConfig-only (no SetPlatformFeeBps)",
  );
  lines.push(
    "  ascending.guardian — needs SetGuardian (crate set_guardian unwired)",
  );
  lines.push(
    "  ascending.platform_recipient — needs SetPlatformRecipient",
  );
  lines.push(
    "  ascending.platform_fee_bps — InitConfig-only (no SetPlatformFeeBps)",
  );
  lines.push(
    "  ascending.challenge_window — InitConfig-only",
  );
  lines.push(
    "  ascending.forfeit_recipient — InitConfig-only",
  );
  lines.push(
    "  ascending.staking_program — InitConfig-only",
  );
  lines.push(
    "  ascending.challenge_bond — settable via SetChallengeBond (not sticky)",
  );
  lines.push(
    "  *.paused — settable via Pause/Unpause (not sticky)",
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
  const decodedCfg = decodePassportConfig(Uint8Array.from(cfgInfo.data));
  if (!decodedCfg.ok) {
    throw new BindModesRefusal(
      "readback_mismatch",
      `passport config decode:${decodedCfg.cause}`,
    );
  }
  const sources = decodedCfg.value.encumbranceSources;
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
  const provisionalDecoded = decodePassportConfig(passportConfig.data);
  if (!provisionalDecoded.ok) {
    throw new BindModesRefusal(
      "config_cannot_grow",
      `passport config decode:${provisionalDecoded.cause}:${provisionalDecoded.detail}`,
    );
  }
  const provisionalSources = provisionalDecoded.value.encumbranceSources;
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

  const fpCfgDecoded = decodeCommerceConfig(fixedPriceConfig.data);
  const ascCfgDecoded = decodeAscendingConfig(ascendingConfig.data);
  const passportDecoded = decodePassportConfig(passportConfig.data);
  if (!fpCfgDecoded.ok || !ascCfgDecoded.ok || !passportDecoded.ok) {
    throw new BindModesRefusal(
      "config_cannot_grow",
      "measured_readback decode refused",
    );
  }

  const priorBytes = priorTokenIdBytes(passportDecoded.value.nextTokenId);
  let sampleTokenId: string | null = null;
  let sampleTokenNote = "next_token_id has no prior mint";
  let sampleTokenBytes: Uint8Array | null = null;
  if (priorBytes != null) {
    const statePda = await deriveSvmPda({
      recipe: "kar-passport/state",
      programId: stack.karPassport,
      seeds: { token_id: priorBytes },
    });
    if (statePda.ok) {
      const stateInfo = await connection.getAccountInfo(
        new PublicKey(statePda.address),
      );
      if (stateInfo != null && stateInfo.data.length > 0) {
        const st = decodePassportState(Uint8Array.from(stateInfo.data));
        if (st.ok) {
          sampleTokenBytes = priorBytes;
          sampleTokenId = tokenIdFromBytes32(priorBytes);
          sampleTokenNote = "prior of on-chain next_token_id (PassportState present)";
        } else {
          sampleTokenNote = `prior PassportState undecodable:${st.cause}`;
        }
      } else {
        sampleTokenNote = "prior PassportState account absent";
      }
    } else {
      sampleTokenNote = `prior state pda:${statePda.cause}`;
    }
  }

  const answerPdas: MeasuredReadbackInput["answerPdas"] = [];
  for (const [modeId, prefix] of [
    [fixedPriceProgramId, FIXED_PRICE_SEED_PREFIX],
    [ascendingProgramId, ASCENDING_SEED_PREFIX],
  ] as const) {
    for (const [intent, intentName] of [
      [INTENT_LEAVE_CHAIN, "LeaveChain"],
      [INTENT_OPEN_CONSIGNMENT, "OpenConsignment"],
    ] as const) {
      const recipe = `kargain-encumbrance/EncumbranceAnswer prefix=${prefix} intent=${intentName}`;
      if (sampleTokenBytes == null) {
        answerPdas.push({
          modeProgramId: modeId,
          seedPrefix: prefix,
          intent,
          intentName,
          address: null,
          recipe,
        });
        continue;
      }
      const derived = await deriveSvmPda({
        recipe: "kargain-encumbrance/answer",
        programId: modeId,
        seeds: {
          seed_prefix: prefix,
          token_id: sampleTokenBytes,
          intent,
        },
      });
      answerPdas.push({
        modeProgramId: modeId,
        seedPrefix: prefix,
        intent,
        intentName,
        address: derived.ok ? derived.address : null,
        recipe: derived.ok
          ? recipe
          : `${recipe} derive_${derived.cause}`,
      });
    }
  }

  const fpBindDecoded =
    fpBindInfo == null || fpBindInfo.data.length === 0
      ? null
      : decodePassportBinding(Uint8Array.from(fpBindInfo.data));
  const ascBindDecoded =
    ascBindInfo == null || ascBindInfo.data.length === 0
      ? null
      : decodePassportBinding(Uint8Array.from(ascBindInfo.data));

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
  console.log(
    formatMeasuredReadback({
      fixedPriceConfig: fpCfgDecoded.value,
      ascendingConfig: ascCfgDecoded.value,
      fixedPriceConfigAddress: pdas.fixedPriceConfig,
      ascendingConfigAddress: pdas.ascendingConfig,
      fixedPriceConfigSize: fixedPriceConfig.data.length,
      ascendingConfigSize: ascendingConfig.data.length,
      passportConfig: passportDecoded.value,
      passportConfigAddress: pdas.passportConfig,
      passportConfigSize: passportConfig.data.length,
      fixedPriceBinding:
        fpBindDecoded != null && fpBindDecoded.ok
          ? {
              address: pdas.fixedPriceBinding,
              passportProgram: fpBindDecoded.value.passportProgram,
              owner: fpBindInfo!.owner.toBase58(),
            }
          : null,
      ascendingBinding:
        ascBindDecoded != null && ascBindDecoded.ok
          ? {
              address: pdas.ascendingBinding,
              passportProgram: ascBindDecoded.value.passportProgram,
              owner: ascBindInfo!.owner.toBase58(),
            }
          : null,
      sampleTokenId,
      sampleTokenNote,
      answerPdas,
    }),
  );
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
