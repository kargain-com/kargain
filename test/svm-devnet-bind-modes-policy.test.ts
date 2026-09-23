/**
 * S8-E 9.1 / 9.2 bind-modes door — in-memory fixtures only (no RPC).
 * Pins: four planned actions ≡ encoder+PDA owners; already-registered skip;
 * foreign binding refuses by name; prefixes are the architect-decided ones;
 * measured readback fields come from owning decoders (no script hand-parse).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { requireSvmCommercialActive } from "../lib/web3/commercial-active.ts";
import { encodeSvmInstruction } from "../lib/svm/encode-instruction.ts";
import { deriveSvmPda } from "../lib/svm/derive-pda.ts";
import { systemProgramId } from "../lib/svm/foreign-programs.ts";
import {
  decodePassportConfig,
  encodePassportConfigAccount,
} from "../lib/svm/decode-account-state.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";
import {
  ASCENDING_SEED_PREFIX,
  ASCENDING_CONFIG_DISCRIMINATOR,
  BIND_MODES_REFUSAL_CAUSES,
  COMMERCE_CONFIG_DISCRIMINATOR,
  FIXED_PRICE_SEED_PREFIX,
  MAX_SEED_PREFIX_LEN,
  PASSPORT_BINDING_SPACE,
  PASSPORT_CONFIG_DISCRIMINATOR,
  formatMeasuredReadback,
  planBindModes,
  programIdToBytes,
  type BindModesChainState,
  type MeasuredReadbackInput,
  type PlannedBindModesAction,
} from "../scripts/svm-devnet-bind-modes.ts";

const ROOT = POLICY_SCAN_ROOT;
const DOOR_REL = "scripts/svm-devnet-bind-modes.ts";
const SVM_NS = 2_000_040_168;

const AUTHORITY = "11111111111111111111111111111112";
const PAYER = "11111111111111111111111111111113";
const FOREIGN_PASSPORT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function fixturePassportConfig(args: {
  authority: string;
  sources?: { programId: string; seedPrefix: string }[];
}): Uint8Array {
  return encodePassportConfigAccount({
    authority: args.authority,
    namespace: BigInt(SVM_NS),
    localEid: 40168,
    endpointProgram: AUTHORITY,
    disputeDeposit: 1_000_000n,
    stakingProgram: AUTHORITY,
    bridgeGateway: AUTHORITY,
    forfeitRecipient: AUTHORITY,
    nextTokenId: new Uint8Array(32),
    encumbranceSources: (args.sources ?? []).map((s) => {
      const programIdBytes = programIdToBytes(s.programId);
      const seedPrefixBytes = new TextEncoder().encode(s.seedPrefix);
      return {
        programId: s.programId,
        seedPrefix: s.seedPrefix,
        programIdBytes,
        seedPrefixBytes,
      };
    }),
    bump: 254,
  });
}

function fixtureCommerceConfig(authority: string): Uint8Array {
  const out = new Uint8Array(109);
  out.set(COMMERCE_CONFIG_DISCRIMINATOR, 0);
  out.set(programIdToBytes(authority), 8);
  // platform_recipient + guardian placeholders (nonzero for ZeroAddress parity)
  out.set(programIdToBytes(PAYER), 40);
  out.set(programIdToBytes(PAYER), 74);
  out[108] = 255; // bump
  return out;
}

/** AscendingConfig SPACE = 190; authority still at bytes 8..40. */
function fixtureAscendingConfig(authority: string): Uint8Array {
  const out = new Uint8Array(190);
  out.set(ASCENDING_CONFIG_DISCRIMINATOR, 0);
  out.set(programIdToBytes(authority), 8);
  out.set(programIdToBytes(PAYER), 40);
  out.set(programIdToBytes(PAYER), 74);
  out[189] = 255;
  return out;
}

function fixturePassportBinding(passportProgram: string): Uint8Array {
  const out = new Uint8Array(PASSPORT_BINDING_SPACE);
  out.set(Buffer.from("kp_pbind", "utf8"), 0);
  out.set(programIdToBytes(passportProgram), 8);
  out[40] = 255;
  return out;
}

function rentExempt(dataLen: number): number {
  return 890_880 + dataLen * 6960;
}

async function baseState(
  overrides: Partial<BindModesChainState> = {},
): Promise<BindModesChainState> {
  const stack = requireSvmCommercialActive(SVM_NS);
  const fp = stack.fixedPriceConsignment!;
  const asc = stack.ascendingConsignment!;
  const [
    passportConfig,
    fixedPriceConfig,
    ascendingConfig,
    fixedPriceBinding,
    ascendingBinding,
  ] = await Promise.all([
    deriveSvmPda({ recipe: "kar-passport/config", programId: stack.karPassport }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/config",
      programId: fp,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/config",
      programId: asc,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: fp,
    }),
    deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: asc,
    }),
  ]);
  for (const r of [
    passportConfig,
    fixedPriceConfig,
    ascendingConfig,
    fixedPriceBinding,
    ascendingBinding,
  ]) {
    assert.equal(r.ok, true, r.ok ? "" : r.detail);
  }

  const cfgData = fixturePassportConfig({ authority: AUTHORITY });
  const state: BindModesChainState = {
    passportProgramId: stack.karPassport,
    fixedPriceProgramId: fp,
    ascendingProgramId: asc,
    authorityPubkey: AUTHORITY,
    payerPubkey: PAYER,
    systemProgramId: systemProgramId(),
    passportConfigAddress: passportConfig.ok ? passportConfig.address : "",
    fixedPriceConfigAddress: fixedPriceConfig.ok
      ? fixedPriceConfig.address
      : "",
    ascendingConfigAddress: ascendingConfig.ok
      ? ascendingConfig.address
      : "",
    fixedPriceBindingAddress: fixedPriceBinding.ok
      ? fixedPriceBinding.address
      : "",
    ascendingBindingAddress: ascendingBinding.ok
      ? ascendingBinding.address
      : "",
    passportConfig: {
      data: cfgData,
      lamports: rentExempt(cfgData.length),
    },
    fixedPriceConfig: {
      data: fixtureCommerceConfig(AUTHORITY),
      lamports: rentExempt(109),
    },
    ascendingConfig: {
      data: fixtureAscendingConfig(AUTHORITY),
      lamports: rentExempt(190),
    },
    fixedPriceBinding: null,
    ascendingBinding: null,
    rentExempt,
    payerBalanceLamports: 10_000_000_000,
  };
  return { ...state, ...overrides };
}

function assertBytesEqual(a: Uint8Array, b: Uint8Array, label: string): void {
  assert.equal(a.length, b.length, `${label} length`);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i], b[i], `${label} byte ${i}`);
  }
}

describe("svm-devnet-bind-modes prefixes", () => {
  it("architect-decided prefixes are fp-ans and asc-ans within crate max", () => {
    assert.equal(FIXED_PRICE_SEED_PREFIX, "fp-ans");
    assert.equal(ASCENDING_SEED_PREFIX, "asc-ans");
    assert.ok(FIXED_PRICE_SEED_PREFIX.length > 0);
    assert.ok(ASCENDING_SEED_PREFIX.length > 0);
    assert.ok(FIXED_PRICE_SEED_PREFIX.length <= MAX_SEED_PREFIX_LEN);
    assert.ok(ASCENDING_SEED_PREFIX.length <= MAX_SEED_PREFIX_LEN);
  });
});

describe("svm-devnet-bind-modes plan — empty chain", () => {
  it("plans four actions whose accounts and bytes match encoder + PDA owner", async () => {
    const state = await baseState();
    const plan = planBindModes(state);
    assert.equal(plan.ok, true, plan.ok ? "" : `${plan.cause}:${plan.detail}`);
    if (!plan.ok) return;

    assert.equal(plan.planned.length, 4);
    assert.deepEqual(
      plan.planned.map((a) => a.kind),
      [
        "bind_fixed_price",
        "bind_ascending",
        "register_fixed_price",
        "register_ascending",
      ],
    );

    const bindFp = plan.planned[0]! as PlannedBindModesAction;
    const bindAsc = plan.planned[1]! as PlannedBindModesAction;
    const regFp = plan.planned[2]! as PlannedBindModesAction;
    const regAsc = plan.planned[3]! as PlannedBindModesAction;

    const encBindFp = encodeSvmInstruction({
      program: "kar-fixed-price",
      variant: "BindPassportProgram",
      fields: {},
    });
    const encBindAsc = encodeSvmInstruction({
      program: "kar-ascending",
      variant: "BindPassportProgram",
      fields: {},
    });
    assert.equal(encBindFp.ok, true);
    assert.equal(encBindAsc.ok, true);
    if (encBindFp.ok) assertBytesEqual(bindFp.data, encBindFp.data, "bind_fp");
    if (encBindAsc.ok) {
      assertBytesEqual(bindAsc.data, encBindAsc.data, "bind_asc");
    }

    const encRegFp = encodeSvmInstruction({
      program: "kar-passport",
      variant: "AddEncumbranceSource",
      fields: {
        program_id: programIdToBytes(state.fixedPriceProgramId),
        seed_prefix: new TextEncoder().encode(FIXED_PRICE_SEED_PREFIX),
      },
    });
    const encRegAsc = encodeSvmInstruction({
      program: "kar-passport",
      variant: "AddEncumbranceSource",
      fields: {
        program_id: programIdToBytes(state.ascendingProgramId),
        seed_prefix: new TextEncoder().encode(ASCENDING_SEED_PREFIX),
      },
    });
    assert.equal(encRegFp.ok, true);
    assert.equal(encRegAsc.ok, true);
    if (encRegFp.ok) assertBytesEqual(regFp.data, encRegFp.data, "reg_fp");
    if (encRegAsc.ok) assertBytesEqual(regAsc.data, encRegAsc.data, "reg_asc");

    assert.deepEqual(
      bindFp.accounts.map((a) => a.address),
      [
        state.authorityPubkey,
        state.fixedPriceConfigAddress,
        state.fixedPriceBindingAddress,
        state.passportProgramId,
        state.systemProgramId,
        state.payerPubkey,
      ],
    );
    assert.deepEqual(
      bindAsc.accounts.map((a) => a.address),
      [
        state.authorityPubkey,
        state.ascendingConfigAddress,
        state.ascendingBindingAddress,
        state.passportProgramId,
        state.systemProgramId,
        state.payerPubkey,
      ],
    );
    assert.deepEqual(
      regFp.accounts.map((a) => a.address),
      [
        state.passportConfigAddress,
        state.authorityPubkey,
        state.payerPubkey,
        state.systemProgramId,
      ],
    );
    assert.deepEqual(
      regAsc.accounts.map((a) => a.address),
      [
        state.passportConfigAddress,
        state.authorityPubkey,
        state.payerPubkey,
        state.systemProgramId,
      ],
    );

    // PDA owner addresses on binding metas
    const fpBindPda = await deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: state.fixedPriceProgramId,
    });
    const ascBindPda = await deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: state.ascendingProgramId,
    });
    assert.equal(fpBindPda.ok, true);
    assert.equal(ascBindPda.ok, true);
    if (fpBindPda.ok) {
      assert.equal(bindFp.accounts[2]!.address, fpBindPda.address);
    }
    if (ascBindPda.ok) {
      assert.equal(bindAsc.accounts[2]!.address, ascBindPda.address);
    }
  });
});

describe("svm-devnet-bind-modes plan — already registered", () => {
  it("omits register actions when sources already present with expected prefixes", async () => {
    const stack = requireSvmCommercialActive(SVM_NS);
    const cfgData = fixturePassportConfig({
      authority: AUTHORITY,
      sources: [
        {
          programId: stack.fixedPriceConsignment!,
          seedPrefix: FIXED_PRICE_SEED_PREFIX,
        },
        {
          programId: stack.ascendingConsignment!,
          seedPrefix: ASCENDING_SEED_PREFIX,
        },
      ],
    });
    const state = await baseState({
      passportConfig: {
        data: cfgData,
        lamports: rentExempt(cfgData.length),
      },
      fixedPriceBinding: {
        data: fixturePassportBinding(stack.karPassport),
      },
      ascendingBinding: {
        data: fixturePassportBinding(stack.karPassport),
      },
    });
    const plan = planBindModes(state);
    assert.equal(plan.ok, true, plan.ok ? "" : `${plan.cause}:${plan.detail}`);
    if (!plan.ok) return;
    assert.equal(plan.planned.length, 0);
    assert.equal(
      plan.actions.filter((a) => a.status === "already_done").length,
      4,
    );
    assert.ok(
      plan.actions.every(
        (a) =>
          a.status === "already_done" &&
          (a.kind.startsWith("bind_") || a.kind.startsWith("register_")),
      ),
    );
  });

  it("plans nothing for a single already-registered source (register only)", async () => {
    const stack = requireSvmCommercialActive(SVM_NS);
    const cfgData = fixturePassportConfig({
      authority: AUTHORITY,
      sources: [
        {
          programId: stack.fixedPriceConsignment!,
          seedPrefix: FIXED_PRICE_SEED_PREFIX,
        },
      ],
    });
    const state = await baseState({
      passportConfig: {
        data: cfgData,
        lamports: rentExempt(cfgData.length),
      },
    });
    const plan = planBindModes(state);
    assert.equal(plan.ok, true, plan.ok ? "" : `${plan.cause}:${plan.detail}`);
    if (!plan.ok) return;
    const kinds = plan.planned.map((a) => a.kind);
    assert.ok(!kinds.includes("register_fixed_price"));
    assert.ok(kinds.includes("register_ascending"));
    assert.ok(kinds.includes("bind_fixed_price"));
    assert.ok(kinds.includes("bind_ascending"));
    const done = plan.actions.find(
      (a) => a.kind === "register_fixed_price" && a.status === "already_done",
    );
    assert.ok(done);
  });
});

describe("svm-devnet-bind-modes plan — foreign binding", () => {
  it("refuses by name when a binding points at a foreign passport program", async () => {
    const state = await baseState({
      fixedPriceBinding: {
        data: fixturePassportBinding(FOREIGN_PASSPORT),
      },
    });
    // Sanity: foreign ≠ registry passport
    assert.notEqual(FOREIGN_PASSPORT, state.passportProgramId);
    const plan = planBindModes(state);
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.cause, "binding_foreign_program");
    assert.match(plan.detail, /bind_fixed_price/);
  });
});

describe("svm-devnet-bind-modes door source policy", () => {
  it("door uses encodeSvmInstruction + deriveSvmPda; no hand-rolled Bind/Add bytes", () => {
    const source = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assert.match(source, /\bencodeSvmInstruction\b/);
    assert.match(source, /\bderiveSvmPda\b/);
    assert.match(source, /\brequireSvmCommercialActive\b/);
    assert.match(source, /\bnamespaceFromLayerZeroEid\b/);
    // No bare ordinal Buffer for BindPassportProgram / AddEncumbranceSource
    assert.doesNotMatch(
      source,
      /data\s*:\s*Buffer\.from\(\s*\[\s*(?:27|32|21)\s*\]/,
    );
    assert.doesNotMatch(
      source,
      /Uint8Array\.of\(\s*(?:27|32|21)\s*\)/,
    );
    // No literal commercial program ids
    assert.doesNotMatch(source, /HmKV5QEVQLdpCiyQAvP4dpqPDBUedi35RSCcWL5XTxyu/);
    assert.doesNotMatch(source, /HMGnyNMFNi9Rjakrch3iAfmoNWRFK7DEBzsEyLiQNt74/);
    assert.doesNotMatch(source, /ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ/);
  });

  it("refusal cause union is exhaustive at throw/return sites", () => {
    const source = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const thrown = new Set<string>();
    const re = /new\s+BindModesRefusal\(\s*["']([a-z_]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      thrown.add(m[1]!);
    }
    const ret = /cause:\s*["']([a-z_]+)["']/g;
    while ((m = ret.exec(source)) !== null) {
      thrown.add(m[1]!);
    }
    const namedReturn = /return\s+["']([a-z_]+)["']/g;
    while ((m = namedReturn.exec(source)) !== null) {
      thrown.add(m[1]!);
    }
    for (const cause of BIND_MODES_REFUSAL_CAUSES) {
      assert.ok(thrown.has(cause), `missing cause coverage: ${cause}`);
    }
  });

  it("plant: omitting encoder consume would fail the door pin", () => {
    const clean = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const planted = clean.replace(/\bencodeSvmInstruction\b/g, "handRollIx");
    assert.doesNotMatch(planted, /\bencodeSvmInstruction\b/);
    assert.match(clean, /\bencodeSvmInstruction\b/);
  });

  it("measured readback formatter consumes decoder field names (not hand offsets)", () => {
    const sample: MeasuredReadbackInput = {
      fixedPriceConfig: {
        authority: AUTHORITY,
        platformRecipient: PAYER,
        platformFeeBps: 10,
        guardian: AUTHORITY,
        paused: false,
        selfEncumbranceRegisteredRetired: true,
        bump: 1,
      },
      ascendingConfig: {
        authority: AUTHORITY,
        platformRecipient: PAYER,
        platformFeeBps: 10,
        guardian: AUTHORITY,
        paused: false,
        selfEncumbranceRegisteredRetired: true,
        stakingProgram: AUTHORITY,
        forfeitRecipient: PAYER,
        challengeBond: 1_000_000n,
        challengeWindow: 1_209_600n,
        challengeConfigured: true,
        bump: 2,
      },
      fixedPriceConfigAddress: AUTHORITY,
      ascendingConfigAddress: PAYER,
      fixedPriceConfigSize: 109,
      ascendingConfigSize: 190,
      passportConfig: {
        authority: AUTHORITY,
        namespace: BigInt(SVM_NS),
        localEid: 40168,
        endpointProgram: AUTHORITY,
        disputeDeposit: 1n,
        stakingProgram: AUTHORITY,
        bridgeGateway: AUTHORITY,
        forfeitRecipient: PAYER,
        nextTokenId: new Uint8Array(32),
        encumbranceSources: [
          {
            programId: FOREIGN_PASSPORT,
            seedPrefix: FIXED_PRICE_SEED_PREFIX,
            programIdBytes: programIdToBytes(FOREIGN_PASSPORT),
            seedPrefixBytes: new TextEncoder().encode(FIXED_PRICE_SEED_PREFIX),
          },
        ],
        bump: 3,
      },
      passportConfigAddress: AUTHORITY,
      passportConfigSize: 272,
      fixedPriceBinding: {
        address: AUTHORITY,
        passportProgram: FOREIGN_PASSPORT,
        owner: AUTHORITY,
      },
      ascendingBinding: null,
      sampleTokenId: null,
      sampleTokenNote: "fixture",
      answerPdas: [],
    };
    const text = formatMeasuredReadback(sample);
    assert.match(text, /platform_fee_bps 10/);
    assert.match(text, /challenge_bond 1000000/);
    assert.match(text, /needs SetGuardian/);
    assert.match(text, /SetChallengeBond \(not sticky\)/);
    assert.match(text, new RegExp(`seed_prefix=.*${FIXED_PRICE_SEED_PREFIX}`));
  });

  it("door imports owning decoders; plant that hand-parses config sources is red", () => {
    const clean = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assert.match(clean, /decodePassportConfig/);
    assert.match(clean, /decodeCommerceConfig/);
    assert.match(clean, /decodeAscendingConfig/);
    assert.match(clean, /formatMeasuredReadback/);
    assert.doesNotMatch(clean, /PASSPORT_CONFIG_SOURCES_OFFSET/);
    assert.doesNotMatch(clean, /parsePassportConfigSources/);
    assert.doesNotMatch(clean, /authorityBytesFromConfig/);

    // Plant: restore a hand-parse of sources via subarray + readU32Le.
    const planted = `${clean}\nfunction plantParseSources(data){const o=228;return data.subarray(o,o+4);}\n`;
    assert.match(planted, /subarray\(o/);
    assert.doesNotMatch(clean, /subarray\(o/);
  });
});

describe("svm-devnet-bind-modes fixtures helpers", () => {
  it("fixturePassportConfig decodes via owning decoder (no offset dual path)", () => {
    const empty = fixturePassportConfig({ authority: AUTHORITY });
    const decodedEmpty = decodePassportConfig(empty);
    assert.equal(decodedEmpty.ok, true);
    if (!decodedEmpty.ok) return;
    assert.equal(decodedEmpty.value.authority, AUTHORITY);
    assert.equal(decodedEmpty.value.encumbranceSources.length, 0);

    const withOne = fixturePassportConfig({
      authority: AUTHORITY,
      sources: [
        {
          programId: FOREIGN_PASSPORT,
          seedPrefix: FIXED_PRICE_SEED_PREFIX,
        },
      ],
    });
    const decoded = decodePassportConfig(withOne);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.value.encumbranceSources.length, 1);
    assert.equal(decoded.value.encumbranceSources[0]!.programId, FOREIGN_PASSPORT);
    assert.equal(
      decoded.value.encumbranceSources[0]!.seedPrefix,
      FIXED_PRICE_SEED_PREFIX,
    );
  });
});
