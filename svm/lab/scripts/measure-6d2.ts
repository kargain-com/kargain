/**
 * S8-E 6d-2 — measure time-proof without program warps.
 *
 * One command (from svm/lab):
 *   pnpm measure:6d2
 *
 * Four hypotheses, structured JSON each. Does not grow measure-litesvm.ts.
 * Lab-scoped only — not wired into test:ci / test:verify / stand.
 * Does not rebuild .so; loads unmodified stand artifacts.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  LiteSVM,
  FailedTransactionMetadata,
  type TransactionMetadata,
} from "litesvm";
import {
  AccountRole,
  address,
  addSignersToTransactionMessage,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  getProgramDerivedAddress,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

export const MEASURE_6D2_HYPOTHESES = ["H1", "H2", "H3", "H4"] as const;
export const MEASURE_6D2_ISOLATION = ["A", "B", "C"] as const;

/** Isolation A — client TransferV1 to mpl-core only (CreateV1 first if needed). */
const ISOLATION_A = "A" as const;
/** Isolation B — harness CoreTransferOwnerToCustody (our CPI / core_custody). */
const ISOLATION_B = "B" as const;
/** Isolation C — FixedPrice OpenDirect after MintPassport+Bind. */
const ISOLATION_C = "C" as const;

const require = createRequire(import.meta.url);
const { Keypair, PublicKey } = require("@solana/web3.js") as typeof import("@solana/web3.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(__dirname, "..");
const ROOT = path.resolve(LAB, "../..");
const SVM = path.join(ROOT, "svm");
const DEPLOY = path.join(SVM, "target/deploy");
const CORE_SO =
  [
    path.join(LAB, "fixtures/mpl_core_release_0.15.1.so"),
    path.join(LAB, "fixtures/mpl_core.so"),
  ].find((p) => existsSync(p)) ?? path.join(LAB, "fixtures/mpl_core_release_0.15.1.so");

const LLVM_READOBJ = path.join(
  process.env.HOME ?? "",
  ".cache/solana/v1.56/platform-tools/llvm/bin/llvm-readobj",
);
const AGAVE_BIN = path.join(
  process.env.HOME ?? "",
  ".local/share/solana/install/active_release/bin",
);

const CORE = address("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SYSTEM = address("11111111111111111111111111111111");
const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";

const RECALL_COOLDOWN_SECS = 7 * 24 * 60 * 60;
const SLOT_MS_ASSUMED = 400;
const WARP_SLOTS_7D = Math.ceil((RECALL_COOLDOWN_SECS * 1000) / SLOT_MS_ASSUMED) + 10_000;
const WARP_SLOTS_3D = Math.ceil((3 * 24 * 60 * 60 * 1000) / SLOT_MS_ASSUMED);
const WARP_SLOTS_30D = Math.ceil((30 * 24 * 60 * 60 * 1000) / SLOT_MS_ASSUMED);

const FP_IX = {
  InitConfig: 0,
  OpenDirect: 7,
  RequestRecall: 12,
  ForceRecall: 13,
  BindPassportProgram: 27,
} as const;

const PASSPORT_IX = {
  Initialize: 0,
  SetBridgeGateway: 1,
  MintPassport: 2,
  AddEncumbranceSource: 21,
} as const;

const HARNESS_IX = {
  CoreCreateAsset: 21,
  CoreTransferOwnerToCustody: 22,
} as const;

/** mpl-core CreateV1 / TransferV1 discriminators (kinobi). */
const MPL_CREATE_V1 = 0;
const MPL_TRANSFER_V1 = 14;

const H4_RPC_PORT = Number(process.env.SVM_6D2_RPC_PORT ?? "18999");
/** Websocket is rpc+1 on this validator; keep faucet off that port. */
const H4_WS_PORT = H4_RPC_PORT + 1;
const H4_FAUCET_PORT = H4_RPC_PORT + 2;
const H4_LEDGER = process.env.SVM_6D2_LEDGER ?? "/tmp/kargain-svm-6d2-ledger";
const H4_RPC = `http://127.0.0.1:${H4_RPC_PORT}`;

type Report = Record<string, unknown>;

function loadProgramAddress(name: string): Address {
  const kpPath = path.join(DEPLOY, `${name}-keypair.json`);
  if (!existsSync(kpPath)) throw new Error(`missing ${kpPath}`);
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")));
  return address(Keypair.fromSecretKey(secret).publicKey.toBase58());
}

function encU32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function encU64(n: bigint | number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function encU16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function encString(s: string): Uint8Array {
  const body = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + body.length);
  out.set(encU32(body.length), 0);
  out.set(body, 4);
  return out;
}
function encU128Le(n: bigint): Uint8Array {
  const b = new Uint8Array(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}
function pkBytes(a: Address): Uint8Array {
  return new PublicKey(a).toBytes();
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function pda(program: Address, seeds: Uint8Array[]): Promise<[Address, number]> {
  const [addr, bump] = await getProgramDerivedAddress({
    programAddress: program,
    seeds,
  });
  return [addr, bump];
}

function meta(
  addr: Address,
  role: (typeof AccountRole)[keyof typeof AccountRole],
): { address: Address; role: typeof role } {
  return { address: addr, role };
}

async function sendSigned(
  svm: LiteSVM,
  signers: KeyPairSigner[],
  instruction: Instruction,
): Promise<TransactionMetadata | FailedTransactionMetadata> {
  const payer = signers[0]!;
  const extras = signers.slice(1);
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
    (m) => appendTransactionMessageInstruction(instruction, m),
    (m) => (extras.length ? addSignersToTransactionMessage(extras, m) : m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  return svm.sendTransaction(tx);
}

function cuOf(result: TransactionMetadata | FailedTransactionMetadata): number | null {
  try {
    if (result instanceof FailedTransactionMetadata) {
      return Number(result.meta().computeUnitsConsumed());
    }
    return Number(result.computeUnitsConsumed());
  } catch {
    return null;
  }
}

function errOf(result: FailedTransactionMetadata): string {
  try {
    return String(result.err());
  } catch {
    return "unknown";
  }
}

function logsOf(result: TransactionMetadata | FailedTransactionMetadata): string[] {
  try {
    if (result instanceof FailedTransactionMetadata) return result.meta().logs().slice(-16);
    return result.logs().slice(-16);
  } catch {
    return [];
  }
}

function ixOutcome(
  ix: string,
  result: TransactionMetadata | FailedTransactionMetadata,
): Report {
  if (result instanceof FailedTransactionMetadata) {
    return {
      ok: false,
      ix,
      err: errOf(result),
      cu: cuOf(result),
      logs: logsOf(result),
    };
  }
  return { ok: true, ix, cu: cuOf(result), logs: logsOf(result) };
}

function dumpSbpf(soPath: string, label: string): Report {
  const command = existsSync(LLVM_READOBJ)
    ? `${LLVM_READOBJ} --file-headers --notes ${soPath}`
    : `(missing llvm-readobj)`;
  let output = "";
  try {
    output = existsSync(LLVM_READOBJ)
      ? execFileSync(LLVM_READOBJ, ["--file-headers", "--notes", soPath], {
          encoding: "utf8",
        })
      : "llvm-readobj not found";
  } catch (e) {
    output = String(e);
  }
  const flags = output.match(/Flags\s*\[\s*\((0x[0-9a-fA-F]+)\)/)?.[1] ?? null;
  const machine = output.match(/Machine:\s+(\S+)/)?.[1] ?? null;
  const format = output.match(/Format:\s+(\S+)/)?.[1] ?? null;
  const notesEmpty = /NoteSections\s*\[\s*\]/.test(output);
  const isStandV0 =
    soPath.includes("target/deploy") || soPath.includes("mpl_core_release");
  return {
    label,
    path: soPath,
    bytes: existsSync(soPath) ? readFileSync(soPath).length : 0,
    artifact_class: soPath.includes("mpl_core")
      ? "mpl-core fixture (Devnet dump / release 0.15.1) — not a Kargain --arch build"
      : isStandV0
        ? "v0 stand preload (cargo-build-sbf --arch v0 → --bpf-program). Shipping Devnet = --arch v3; this file is the stand artifact 6d loaded."
        : "unknown",
    llvm_readobj: LLVM_READOBJ,
    command,
    output,
    parsed: {
      format,
      machine,
      e_flags: flags,
      notes: notesEmpty ? "empty" : "present",
      sbpf_version:
        flags === "0x0"
          ? "e_flags=0 → SBF v0 (stand preload / classic SBF). Not v3 shipping."
          : `e_flags=${flags}`,
    },
  };
}

function bootLiteSvm(): {
  svm: LiteSVM;
  FP: Address;
  PASSPORT: Address;
  GATEWAY: Address;
  ENDPOINT: Address;
  STAKING: Address;
  HARNESS: Address;
} {
  const FP = loadProgramAddress("kar_fixed_price");
  const PASSPORT = loadProgramAddress("kar_passport");
  const GATEWAY = loadProgramAddress("kar_gateway");
  const ENDPOINT = loadProgramAddress("mock_endpoint");
  const STAKING = loadProgramAddress("mock_staking");
  const HARNESS = loadProgramAddress("consignment_harness");
  const svm = new LiteSVM().withSysvars();
  svm.addProgramFromFile(FP, path.join(DEPLOY, "kar_fixed_price.so"));
  svm.addProgramFromFile(CORE, CORE_SO);
  svm.addProgramFromFile(PASSPORT, path.join(DEPLOY, "kar_passport.so"));
  svm.addProgramFromFile(GATEWAY, path.join(DEPLOY, "kar_gateway.so"));
  svm.addProgramFromFile(ENDPOINT, path.join(DEPLOY, "mock_endpoint.so"));
  svm.addProgramFromFile(STAKING, path.join(DEPLOY, "mock_staking.so"));
  svm.addProgramFromFile(HARNESS, path.join(DEPLOY, "consignment_harness.so"));
  return { svm, FP, PASSPORT, GATEWAY, ENDPOINT, STAKING, HARNESS };
}

function mplCreateV1Data(name: string, uri: string): Uint8Array {
  return concatBytes(
    Uint8Array.of(MPL_CREATE_V1),
    Uint8Array.of(0), // DataState::AccountState
    encString(name),
    encString(uri),
    Uint8Array.of(0), // plugins None
  );
}

function mplTransferV1Data(): Uint8Array {
  return Uint8Array.of(MPL_TRANSFER_V1, 0); // disc 14 + compressionProof None
}

async function runIsolationA(svm: LiteSVM): Promise<Report> {
  const payer = await generateKeyPairSigner();
  const owner = await generateKeyPairSigner();
  const assetKp = await generateKeyPairSigner();
  const newOwner = await generateKeyPairSigner();
  for (const s of [payer, owner, assetKp]) {
    svm.airdrop(s.address, lamports(20_000_000_000n));
  }
  const create = await sendSigned(svm, [payer, assetKp], {
    programAddress: CORE,
    accounts: [
      meta(assetKp.address, AccountRole.WRITABLE_SIGNER),
      meta(CORE, AccountRole.READONLY),
      meta(CORE, AccountRole.READONLY),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(owner.address, AccountRole.READONLY),
      meta(payer.address, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
      meta(CORE, AccountRole.READONLY),
    ],
    data: mplCreateV1Data("6d2-a", "ar://6d2-a"),
  });
  const createOut = ixOutcome("mpl-core CreateV1 (client)", create);
  let assetAddr = assetKp.address;
  let authority = owner;
  let createUsed = createOut;
  if (!createOut.ok) {
    const fallback = await harnessCreateForClientTransfer(svm);
    if (!fallback.ok) {
      return {
        id: ISOLATION_A,
        path: "client instruction → mpl-core TransferV1 only (CreateV1 first)",
        isolates: "mpl-core + runtime, no Kargain CPI",
        create: createOut,
        harness_create_fallback: fallback.create,
        transfer: { skipped: true, reason: "CreateV1 failed (client and harness)" },
        verdict: "create_failed",
      };
    }
    assetAddr = fallback.asset;
    authority = fallback.owner;
    createUsed = {
      ...fallback.create,
      fallback: "harness CoreCreateAsset then client TransferV1",
    };
  }
  const transfer = await sendSigned(svm, [payer, authority], {
    programAddress: CORE,
    accounts: [
      meta(assetAddr, AccountRole.WRITABLE),
      meta(CORE, AccountRole.READONLY),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(authority.address, AccountRole.READONLY_SIGNER),
      meta(newOwner.address, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
      meta(CORE, AccountRole.READONLY),
    ],
    data: mplTransferV1Data(),
  });
  const transferOut = ixOutcome("mpl-core TransferV1 (client)", transfer);
  return {
    id: ISOLATION_A,
    path: "client instruction → mpl-core TransferV1 only (CreateV1 first)",
    isolates: "mpl-core + runtime, no Kargain CPI",
    create: createUsed,
    transfer: transferOut,
    verdict: transferOut.ok ? "transfer_ok" : "transfer_fault",
  };
}

async function harnessCreateForClientTransfer(svm: LiteSVM): Promise<{
  ok: boolean;
  asset: Address;
  owner: KeyPairSigner;
  create: Report;
}> {
  const HARNESS = loadProgramAddress("consignment_harness");
  const payer = await generateKeyPairSigner();
  const owner = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(20_000_000_000n));
  svm.airdrop(owner.address, lamports(20_000_000_000n));
  const tokenId = new Uint8Array(32);
  tokenId[31] = 0x61;
  const [asset] = await pda(HARNESS, [new TextEncoder().encode("asset"), tokenId]);
  const [freeze] = await pda(HARNESS, [new TextEncoder().encode("freeze")]);
  const create = await sendSigned(svm, [payer], {
    programAddress: HARNESS,
    accounts: [
      meta(asset, AccountRole.WRITABLE),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(owner.address, AccountRole.READONLY),
      meta(freeze, AccountRole.READONLY),
      meta(CORE, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(
      Uint8Array.of(HARNESS_IX.CoreCreateAsset),
      tokenId,
      Uint8Array.of(0),
      Uint8Array.of(0),
    ),
  });
  return {
    ok: !(create instanceof FailedTransactionMetadata),
    asset,
    owner,
    create: ixOutcome("harness CoreCreateAsset (A fallback)", create),
  };
}

async function runIsolationB(svm: LiteSVM, HARNESS: Address): Promise<Report> {
  const payer = await generateKeyPairSigner();
  const seller = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(20_000_000_000n));
  svm.airdrop(seller.address, lamports(20_000_000_000n));
  const tokenId = new Uint8Array(32);
  tokenId[31] = 0x6d;
  const [asset] = await pda(HARNESS, [new TextEncoder().encode("asset"), tokenId]);
  const [custody] = await pda(HARNESS, [new TextEncoder().encode("custody")]);
  const [freeze] = await pda(HARNESS, [new TextEncoder().encode("freeze")]);
  const create = await sendSigned(svm, [payer], {
    programAddress: HARNESS,
    accounts: [
      meta(asset, AccountRole.WRITABLE),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(seller.address, AccountRole.READONLY),
      meta(freeze, AccountRole.READONLY),
      meta(CORE, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(
      Uint8Array.of(HARNESS_IX.CoreCreateAsset),
      tokenId,
      Uint8Array.of(0),
      Uint8Array.of(0),
    ),
  });
  const createOut = ixOutcome("harness CoreCreateAsset", create);
  if (!createOut.ok) {
    return {
      id: ISOLATION_B,
      path: "harness CoreTransferOwnerToCustody",
      isolates: "our invoke / core_custody",
      create: createOut,
      transfer: { skipped: true },
      verdict: "create_failed",
    };
  }
  const transfer = await sendSigned(svm, [payer, seller], {
    programAddress: HARNESS,
    accounts: [
      meta(asset, AccountRole.WRITABLE),
      meta(seller.address, AccountRole.READONLY_SIGNER),
      meta(custody, AccountRole.READONLY),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(CORE, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(Uint8Array.of(HARNESS_IX.CoreTransferOwnerToCustody), tokenId),
  });
  const transferOut = ixOutcome("harness CoreTransferOwnerToCustody", transfer);
  return {
    id: ISOLATION_B,
    path: "harness CoreTransferOwnerToCustody",
    isolates: "our invoke / core_custody",
    create: createOut,
    transfer: transferOut,
    verdict: transferOut.ok ? "transfer_ok" : "transfer_fault",
  };
}

async function runIsolationC(
  svm: LiteSVM,
  ctx: {
    FP: Address;
    PASSPORT: Address;
    GATEWAY: Address;
    ENDPOINT: Address;
    STAKING: Address;
  },
): Promise<Report> {
  const authority = await generateKeyPairSigner();
  const seller = await generateKeyPairSigner();
  const platform = await generateKeyPairSigner();
  const guardian = await generateKeyPairSigner();
  const payer = authority;
  for (const s of [authority, seller, platform, guardian]) {
    svm.airdrop(s.address, lamports(20_000_000_000n));
  }
  const [epConfig] = await pda(ctx.ENDPOINT, [new TextEncoder().encode("ep_config")]);
  const [passportConfig] = await pda(ctx.PASSPORT, [new TextEncoder().encode("config")]);
  const [gatewayConfig] = await pda(ctx.GATEWAY, [new TextEncoder().encode("config")]);
  const [gatewayFreeze] = await pda(ctx.GATEWAY, [new TextEncoder().encode("freeze")]);
  const [configPda] = await pda(ctx.FP, [new TextEncoder().encode("consign-config")]);
  const [binding] = await pda(ctx.FP, [new TextEncoder().encode("passport-bind")]);

  let r = await sendSigned(svm, [payer], {
    programAddress: ctx.ENDPOINT,
    accounts: [
      meta(epConfig, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: Uint8Array.of(0),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_endpoint", err: errOf(r) };
  }

  const NS = 2000040168n;
  const EID = 40168;
  r = await sendSigned(svm, [payer], {
    programAddress: ctx.PASSPORT,
    accounts: [
      meta(passportConfig, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(
      Uint8Array.of(PASSPORT_IX.Initialize),
      encU128Le(NS),
      encU32(EID),
      pkBytes(ctx.ENDPOINT),
      encU64(1_000_000n),
      pkBytes(ctx.STAKING),
      pkBytes(authority.address),
    ),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_passport_init", err: errOf(r), logs: logsOf(r) };
  }

  r = await sendSigned(svm, [payer], {
    programAddress: ctx.GATEWAY,
    accounts: [
      meta(gatewayConfig, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(
      Uint8Array.of(0),
      encU32(EID),
      pkBytes(ctx.ENDPOINT),
      pkBytes(ctx.PASSPORT),
      encU128Le(NS),
    ),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_gateway_init", err: errOf(r) };
  }

  r = await sendSigned(svm, [payer], {
    programAddress: ctx.PASSPORT,
    accounts: [
      meta(passportConfig, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.READONLY_SIGNER),
    ],
    data: concatBytes(Uint8Array.of(PASSPORT_IX.SetBridgeGateway), pkBytes(gatewayConfig)),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_set_bridge", err: errOf(r) };
  }

  const seedPrefix = new TextEncoder().encode("ans");
  r = await sendSigned(svm, [payer], {
    programAddress: ctx.PASSPORT,
    accounts: [
      meta(passportConfig, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.READONLY_SIGNER),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(
      Uint8Array.of(PASSPORT_IX.AddEncumbranceSource),
      pkBytes(ctx.FP),
      encU32(seedPrefix.length),
      seedPrefix,
    ),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_add_source", err: errOf(r), logs: logsOf(r) };
  }

  r = await sendSigned(svm, [payer], {
    programAddress: ctx.FP,
    accounts: [
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(configPda, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.READONLY_SIGNER),
      meta(platform.address, AccountRole.READONLY),
      meta(guardian.address, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(Uint8Array.of(FP_IX.InitConfig), encU16(100)),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_init_config", err: errOf(r), logs: logsOf(r) };
  }

  r = await sendSigned(svm, [payer], {
    programAddress: ctx.FP,
    accounts: [
      meta(authority.address, AccountRole.READONLY_SIGNER),
      meta(configPda, AccountRole.READONLY),
      meta(binding, AccountRole.WRITABLE),
      meta(ctx.PASSPORT, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
    ],
    data: Uint8Array.of(FP_IX.BindPassportProgram),
  });
  if (r instanceof FailedTransactionMetadata) {
    return { id: ISOLATION_C, verdict: "fail_bind", err: errOf(r), logs: logsOf(r) };
  }

  const cfgAcc = svm.getAccount(passportConfig);
  if (!cfgAcc.exists) return { id: ISOLATION_C, verdict: "fail_no_config" };
  const NEXT_TOKEN_ID_OFFSET = 8 + 32 + 16 + 4 + 32 + 8 + 32 + 32 + 32;
  const tokenId = cfgAcc.data.slice(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32);
  const [asset] = await pda(ctx.PASSPORT, [new TextEncoder().encode("asset"), tokenId]);
  const [state] = await pda(ctx.PASSPORT, [new TextEncoder().encode("state"), tokenId]);
  r = await sendSigned(svm, [payer], {
    programAddress: ctx.PASSPORT,
    accounts: [
      meta(passportConfig, AccountRole.WRITABLE),
      meta(authority.address, AccountRole.READONLY_SIGNER),
      meta(asset, AccountRole.WRITABLE),
      meta(state, AccountRole.WRITABLE),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(seller.address, AccountRole.READONLY),
      meta(gatewayFreeze, AccountRole.READONLY),
      meta(CORE, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
    ],
    data: concatBytes(Uint8Array.of(PASSPORT_IX.MintPassport), encString("ar://6d2-c")),
  });
  if (r instanceof FailedTransactionMetadata) {
    return {
      id: ISOLATION_C,
      verdict: "fail_mint",
      err: errOf(r),
      logs: logsOf(r),
    };
  }

  const [consign] = await pda(ctx.FP, [new TextEncoder().encode("consignment"), tokenId]);
  const [custody] = await pda(ctx.FP, [new TextEncoder().encode("custody")]);
  const [challenge] = await pda(ctx.PASSPORT, [new TextEncoder().encode("challenge"), tokenId]);
  const [ansLeave] = await pda(ctx.FP, [seedPrefix, tokenId, Uint8Array.of(0)]);
  const [ansOpen] = await pda(ctx.FP, [seedPrefix, tokenId, Uint8Array.of(1)]);
  r = await sendSigned(svm, [payer, seller], {
    programAddress: ctx.FP,
    accounts: [
      meta(seller.address, AccountRole.READONLY_SIGNER),
      meta(configPda, AccountRole.READONLY),
      meta(binding, AccountRole.READONLY),
      meta(passportConfig, AccountRole.READONLY),
      meta(asset, AccountRole.WRITABLE),
      meta(challenge, AccountRole.READONLY),
      meta(ansOpen, AccountRole.READONLY),
      meta(consign, AccountRole.WRITABLE),
      meta(custody, AccountRole.READONLY),
      meta(SYSTEM, AccountRole.READONLY),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(CORE, AccountRole.READONLY),
      meta(ansLeave, AccountRole.WRITABLE),
      meta(ansOpen, AccountRole.WRITABLE),
    ],
    data: concatBytes(
      Uint8Array.of(FP_IX.OpenDirect),
      tokenId,
      new Uint8Array(32),
      Uint8Array.of(0),
      new Uint8Array(32),
      encU64(1_000n),
    ),
  });
  const openOut = ixOutcome("FixedPrice OpenDirect", r);
  return {
    id: ISOLATION_C,
    path: "FixedPrice OpenDirect after MintPassport+Bind",
    isolates: "commercial mover",
    mint: { ok: true, asset },
    open: openOut,
    verdict: openOut.ok ? "open_ok" : "open_fault",
  };
}

function faultOwner(a: Report, b: Report, c: Report): string {
  const aFault = a.verdict === "transfer_fault";
  const bFault = b.verdict === "transfer_fault";
  const cFault = c.verdict === "open_fault";
  if (aFault && bFault && cFault) {
    return "mpl-core + LiteSVM runtime (faults with no Kargain in the invoke stack)";
  }
  if (!aFault && (bFault || cFault)) return "our CPI / commercial mover (client TransferV1 ok)";
  if (aFault && !bFault) return "client encoding or account metas (harness path ok)";
  return `mixed: A=${a.verdict} B=${b.verdict} C=${c.verdict}`;
}

async function runH1(): Promise<Report> {
  const soFiles = [
    { label: "kar_fixed_price", p: path.join(DEPLOY, "kar_fixed_price.so") },
    { label: "consignment_harness", p: path.join(DEPLOY, "consignment_harness.so") },
    { label: "kar_passport", p: path.join(DEPLOY, "kar_passport.so") },
    { label: "mpl-core", p: CORE_SO },
  ];
  const sbpf = soFiles.map((f) => dumpSbpf(f.p, f.label));
  const boot = bootLiteSvm();
  const A = await runIsolationA(boot.svm);
  const B = await runIsolationB(boot.svm, boot.HARNESS);
  const C = await runIsolationC(boot.svm, boot);
  return {
    hypothesis: "H1",
    runtime: "litesvm@1.4.1 (Node) ≡ crate 0.16.0 ≡ Agave 4.2.1",
    command: "pnpm --dir svm/lab measure:6d2 (H1)",
    sbpf,
    isolation: { A, B, C },
    verdict: faultOwner(A, B, C),
  };
}

function listPublishedLitesvm(): Report {
  let output = "";
  let versions: string[] = [];
  try {
    output = execFileSync("npm", ["view", "litesvm", "versions", "--json"], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(output) as unknown;
    versions = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (e) {
    output = String(e);
  }
  const newest = versions[versions.length - 1] ?? null;
  return {
    command: "npm view litesvm versions --json",
    output,
    versions,
    newest,
    node_newest_is_1_4_1: newest === "1.4.1",
    rust_crate: "litesvm 0.16.x ≡ Agave 4.2.1 (no published 4.3 embed)",
    published_agave_4_3: false,
    note:
      newest === "1.4.1"
        ? "No newer published Node LiteSVM than 1.4.1. Git main / unpublished Agave 4.3 is not a product path."
        : `Newest published is ${newest}; 1.4.1 is the lab pin.`,
  };
}

async function runH2(h1: Report): Promise<Report> {
  const published = listPublishedLitesvm();
  const reuse = published.newest === "1.4.1";
  return {
    hypothesis: "H2",
    command: "npm view litesvm versions --json + reuse H1 A/B if only 1.4.1",
    published,
    rerun: reuse
      ? {
          reused_h1: true,
          isolation: (h1.isolation as Report) ?? null,
          reason: "only published candidate is 1.4.1 — same bytes as H1",
        }
      : { reused_h1: false, note: "would install other published versions; none newer" },
    verdict: reuse
      ? "no published embed matches validator 4.3.0-beta.2; H1 stands"
      : "unexpected newer published version — see published.newest",
  };
}

function runH3(): Report {
  const crateDir = path.join(LAB, "litesvm-probe");
  const command = `cargo run --manifest-path ${crateDir}/Cargo.toml --quiet -- ${CORE_SO} ${path.join(DEPLOY, "consignment_harness.so")} ${path.join(DEPLOY, "consignment_harness-keypair.json")}`;
  let output = "";
  let parsed: Report | null = null;
  try {
    output = execFileSync(
      "cargo",
      [
        "+1.98.1",
        "run",
        "--manifest-path",
        path.join(crateDir, "Cargo.toml"),
        "--quiet",
        "--",
        CORE_SO,
        path.join(DEPLOY, "consignment_harness.so"),
        path.join(DEPLOY, "consignment_harness-keypair.json"),
      ],
      {
        encoding: "utf8",
        cwd: crateDir,
        timeout: 180_000,
        env: { ...process.env, CARGO_TERM_COLOR: "never" },
      },
    );
    const line = output
      .trim()
      .split("\n")
      .reverse()
      .find((l) => l.startsWith("{"));
    if (line) parsed = JSON.parse(line) as Report;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
  }
  return {
    hypothesis: "H3",
    command,
    output,
    rust_probe: parsed,
    solana_program_test_fact:
      "solana-program-test (solana-program 2.3) is a different older runtime than Agave 4.3.0-beta.2 — not used as a product path; H3 is litesvm 0.16 crate only.",
    product_dependency: "none — crate excluded from svm/Cargo.toml workspace",
    verdict: parsed
      ? (parsed.verdict ?? "see rust_probe")
      : "rust_probe_failed_to_run",
  };
}

function decodeClock(data: Uint8Array): {
  slot: bigint;
  epoch_start_timestamp: bigint;
  epoch: bigint;
  leader_schedule_epoch: bigint;
  unix_timestamp: bigint;
} {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    slot: v.getBigUint64(0, true),
    epoch_start_timestamp: v.getBigInt64(8, true),
    epoch: v.getBigUint64(16, true),
    leader_schedule_epoch: v.getBigUint64(24, true),
    unix_timestamp: v.getBigInt64(32, true),
  };
}

function validatorArgs(opts: {
  reset: boolean;
  warpSlot?: number;
}): string[] {
  const CORE_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
  const NOOP = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";
  const noopSo = path.join(LAB, "fixtures/spl_noop.so");
  const need = (name: string): string => {
    const kp = path.join(DEPLOY, `${name}-keypair.json`);
    const secret = Uint8Array.from(JSON.parse(readFileSync(kp, "utf8")));
    return Keypair.fromSecretKey(secret).publicKey.toBase58();
  };
  const args = [
    "--ledger",
    H4_LEDGER,
    "--rpc-port",
    String(H4_RPC_PORT),
    "--faucet-port",
    String(H4_FAUCET_PORT),
    "--quiet",
    "--bpf-program",
    CORE_ID,
    CORE_SO,
    "--bpf-program",
    NOOP,
    noopSo,
    "--bpf-program",
    need("mock_endpoint"),
    path.join(DEPLOY, "mock_endpoint.so"),
    "--bpf-program",
    need("kar_passport"),
    path.join(DEPLOY, "kar_passport.so"),
    "--bpf-program",
    need("kar_gateway"),
    path.join(DEPLOY, "kar_gateway.so"),
    "--bpf-program",
    need("mock_staking"),
    path.join(DEPLOY, "mock_staking.so"),
    "--bpf-program",
    need("kar_pro_staking"),
    path.join(DEPLOY, "kar_pro_staking.so"),
    "--bpf-program",
    need("kar_pro_pass"),
    path.join(DEPLOY, "kar_pro_pass.so"),
    "--bpf-program",
    need("money_harness"),
    path.join(DEPLOY, "money_harness.so"),
    "--bpf-program",
    need("consignment_harness"),
    path.join(DEPLOY, "consignment_harness.so"),
    "--bpf-program",
    need("kar_fixed_price"),
    path.join(DEPLOY, "kar_fixed_price.so"),
    "--bpf-program",
    need("kar_ascending"),
    path.join(DEPLOY, "kar_ascending.so"),
  ];
  if (opts.reset) args.push("--reset");
  if (opts.warpSlot != null) {
    args.push("--warp-slot", String(opts.warpSlot));
  }
  return args;
}

function startValidator(args: string[]): ChildProcess {
  const bin = path.join(AGAVE_BIN, "solana-test-validator");
  const log = "/tmp/kargain-6d2-validator.log";
  const fd = openSync(log, "a");
  const child = spawn(bin, args, {
    env: { ...process.env, PATH: `${AGAVE_BIN}:${process.env.PATH ?? ""}` },
    stdio: ["ignore", fd, fd],
  });
  child.on("exit", () => {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  });
  return child;
}

async function waitRpc(url: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  let healthy = false;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const health = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      if (health.ok) {
        const j = (await health.json()) as { result?: string };
        if (j.result === "ok") healthy = true;
      }
      if (healthy) {
        const slotRes = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getSlot",
            params: [{ commitment: "confirmed" }],
          }),
        });
        const slotJ = (await slotRes.json()) as { result?: number };
        if (typeof slotJ.result === "number" && slotJ.result > 0) return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`validator RPC not ready (health+slot>0): ${url}`);
}

function stopValidator(child: ChildProcess): void {
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(H4_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

async function readClockRpc(): Promise<ReturnType<typeof decodeClock> & { raw_len: number }> {
  const acc = await rpc<{ value: { data: [string, string] } | null }>("getAccountInfo", [
    CLOCK_SYSVAR,
    { encoding: "base64" },
  ]);
  if (!acc.value) throw new Error("Clock sysvar missing");
  const buf = Buffer.from(acc.value.data[0]!, "base64");
  return { ...decodeClock(buf), raw_len: buf.length };
}

async function runH4Lot(
  conn: InstanceType<typeof import("@solana/web3.js").Connection>,
  web3: typeof import("@solana/web3.js"),
): Promise<Report> {
  const {
    Connection: _C,
    Keypair: Kp,
    PublicKey: Pk,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
  } = web3;
  void _C;
  const stand = await import("../../stand/stand-passport-commerce.ts");
  const {
    ensurePassportCommerceStack,
    addEncumbranceSource,
    bindPassportProgram,
    mintPassportAsset,
    addTransferDelegateToCustody,
    grantKeys,
    openFromMandateKeys,
    answerPdas,
    pda: standPda,
    ix,
    SEED,
    ENCUMBRANCE_SEED_PREFIX,
    FP_IX: STAND_FP,
    loadDeployProgramId,
    airdrop,
    encU16: standEncU16,
    encU64: standEncU64,
  } = stand;

  const programId = loadDeployProgramId("kar_fixed_price");
  const authority = stand.loadStandDeployerKeypair();
  const payer = Kp.generate();
  const seller = Kp.generate();
  const agent = Kp.generate();
  const platform = Kp.generate();
  const guardian = Kp.generate();
  for (const k of [authority, payer, seller, agent, platform, guardian]) {
    await airdrop(conn, k, 20);
  }
  const stack = await ensurePassportCommerceStack(conn);
  await addEncumbranceSource(conn, stack, programId);
  const [configPda] = standPda(programId, [SEED.consignConfig]);
  if (!(await conn.getAccountInfo(configPda))) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: true },
            { pubkey: authority.publicKey, isSigner: true, isWritable: false },
            { pubkey: platform.publicKey, isSigner: false, isWritable: false },
            { pubkey: guardian.publicKey, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.concat([Buffer.from([STAND_FP.InitConfig]), standEncU16(100)]),
        ),
      ),
      [payer, authority],
    );
  }
  const binding = await bindPassportProgram(
    conn,
    programId,
    configPda,
    authority,
    payer,
    stack.passportProgram,
  );
  const minted = await mintPassportAsset(conn, stack, payer, seller.publicKey, "ar://6d2-h4");
  const [custody] = standPda(programId, [SEED.custody]);
  const [consign] = standPda(programId, [SEED.consignment, minted.tokenId]);
  const [recall] = standPda(programId, [SEED.recall, minted.tokenId]);
  const [mandate] = standPda(programId, [SEED.mandate, minted.tokenId]);
  const answers = answerPdas(programId, minted.tokenId, ENCUMBRANCE_SEED_PREFIX);
  // RequestRecall/ForceRecall are agented-only (NotOfferedAgented=91 on OpenDirect).
  // OpenFromMandate is the LIVE TransferV1 success path for that pair.
  await addTransferDelegateToCustody(conn, seller, payer, minted.asset, custody);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        grantKeys({
          owner: seller.publicKey,
          binding,
          asset: minted.asset,
          mandate,
          consign,
          custody,
          payer: payer.publicKey,
        }),
        Buffer.concat([
          Buffer.from([STAND_FP.Grant]),
          minted.tokenId,
          agent.publicKey.toBuffer(),
          standEncU64(0n),
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          standEncU64(700n),
          Buffer.from([1]),
          standEncU16(500),
        ]),
      ),
    ),
    [seller, payer],
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        openFromMandateKeys({
          agent: agent.publicKey,
          config: configPda,
          mandate,
          binding,
          passportConfig: stack.passportConfig,
          asset: minted.asset,
          challenge: minted.challenge,
          mayAnswerOpen: answers.open,
          consign,
          custody,
          payer: payer.publicKey,
          answerLeave: answers.leave,
          answerOpen: answers.open,
        }),
        Buffer.concat([
          Buffer.from([STAND_FP.OpenFromMandate]),
          minted.tokenId,
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          standEncU64(1_000n),
        ]),
      ),
    ),
    [agent, payer],
  );
  const assetInfo = await conn.getAccountInfo(minted.asset);
  const owner = assetInfo ? new Pk(assetInfo.data.subarray(33, 65)).toBase58() : null;
  const requestSig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consign, isSigner: false, isWritable: false },
          { pubkey: recall, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([STAND_FP.RequestRecall]), minted.tokenId]),
      ),
    ),
    [seller, payer],
  );
  return {
    ok: true,
    tokenIdHex: minted.tokenId.toString("hex"),
    asset: minted.asset.toBase58(),
    consign: consign.toBase58(),
    recall: recall.toBase58(),
    binding: binding.toBase58(),
    custody: custody.toBase58(),
    seller: seller.publicKey.toBase58(),
    payer: payer.publicKey.toBase58(),
    authority: authority.publicKey.toBase58(),
    core_owner_after_open: owner,
    request_recall_before_warp: requestSig,
    seller_secret: [...seller.secretKey],
    payer_secret: [...payer.secretKey],
    tokenId: [...minted.tokenId],
  };
}

async function tryForceRecallAfterWarp(
  conn: InstanceType<typeof import("@solana/web3.js").Connection>,
  web3: typeof import("@solana/web3.js"),
  lot: Report,
): Promise<Report> {
  const {
    Keypair: Kp,
    PublicKey: Pk,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
  } = web3;
  const stand = await import("../../stand/stand-passport-commerce.ts");
  const { ix, pda: standPda, SEED, ENCUMBRANCE_SEED_PREFIX, answerPdas, FP_IX: STAND_FP, CORE_ID } =
    stand;
  const programId = stand.loadDeployProgramId("kar_fixed_price");
  const seller = Kp.fromSecretKey(Uint8Array.from(lot.seller_secret as number[]));
  const payer = Kp.fromSecretKey(Uint8Array.from(lot.payer_secret as number[]));
  const tokenId = Buffer.from(lot.tokenId as number[]);
  const consign = new Pk(lot.consign as string);
  const recall = new Pk(lot.recall as string);
  const binding = new Pk(lot.binding as string);
  const asset = new Pk(lot.asset as string);
  const custody = new Pk(lot.custody as string);
  const answers = answerPdas(programId, tokenId, ENCUMBRANCE_SEED_PREFIX);
  const passportConfig = standPda(stand.loadDeployProgramId("kar_passport"), [SEED.config])[0];

  try {
    const force = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: seller.publicKey, isSigner: true, isWritable: false },
            { pubkey: consign, isSigner: false, isWritable: true },
            { pubkey: recall, isSigner: false, isWritable: true },
            { pubkey: binding, isSigner: false, isWritable: false },
            { pubkey: passportConfig, isSigner: false, isWritable: false },
            { pubkey: asset, isSigner: false, isWritable: true },
            { pubkey: custody, isSigner: false, isWritable: false },
            { pubkey: seller.publicKey, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: CORE_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: answers.leave, isSigner: false, isWritable: true },
            { pubkey: answers.open, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: false, isWritable: true },
          ],
          Buffer.concat([Buffer.from([STAND_FP.ForceRecall]), tokenId]),
        ),
      ),
      [seller, payer],
    );
    const assetInfo = await conn.getAccountInfo(asset);
    const owner = assetInfo ? new Pk(assetInfo.data.subarray(33, 65)).toBase58() : null;
    return {
      request_recall: "stamped before warp",
      force_recall: { ok: true, sig: force },
      core_owner_after: owner,
      moved_to_seller: owner === seller.publicKey.toBase58(),
      used_ForceRecallRequestedAt: false,
    };
  } catch (e) {
    return {
      request_recall: "stamped before warp",
      force_recall: { ok: false, err: String(e) },
      used_ForceRecallRequestedAt: false,
    };
  }
}

async function runH4(): Promise<Report> {
  const web3 = require("@solana/web3.js") as typeof import("@solana/web3.js");
  const bin = path.join(AGAVE_BIN, "solana-test-validator");
  if (!existsSync(bin)) {
    return {
      hypothesis: "H4",
      verdict: "validator_binary_missing",
      command: bin,
    };
  }
  rmSync(H4_LEDGER, { recursive: true, force: true });
  mkdirSync(H4_LEDGER, { recursive: true });

  const bootArgs = validatorArgs({ reset: true });
  const bootCmd = `${bin} ${bootArgs.join(" ")}`;
  let child = startValidator(bootArgs);
  let lot: Report | null = null;
  let clockBefore: Report | null = null;
  try {
    await waitRpc(H4_RPC, 180_000);
    clockBefore = await readClockRpc();
    const conn = new web3.Connection(H4_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 120_000,
      wsEndpoint: `ws://127.0.0.1:${H4_WS_PORT}`,
    });
    lot = await runH4Lot(conn, web3);
  } catch (e) {
    stopValidator(child);
    return {
      hypothesis: "H4",
      command: bootCmd,
      verdict: "boot_or_open_failed",
      err: String(e),
      clock_before: clockBefore,
    };
  }
  stopValidator(child);
  await new Promise((r) => setTimeout(r, 4000));

  const restartArgs = validatorArgs({ reset: false, warpSlot: WARP_SLOTS_7D });
  const restartCmd = `${bin} ${restartArgs.join(" ")}`;
  child = startValidator(restartArgs);
  let clockAfter: Report | null = null;
  let force: Report | null = null;
  try {
    await waitRpc(H4_RPC, 180_000);
    clockAfter = await readClockRpc();
    const beforeTs = Number((clockBefore as { unix_timestamp: bigint }).unix_timestamp);
    const afterTs = Number((clockAfter as { unix_timestamp: bigint }).unix_timestamp);
    const jumped = afterTs - beforeTs >= RECALL_COOLDOWN_SECS;
    const slotOnly =
      Number((clockAfter as { slot: bigint }).slot) !==
        Number((clockBefore as { slot: bigint }).slot) && !jumped;
    if (jumped && lot) {
      const conn = new web3.Connection(H4_RPC, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 120_000,
        wsEndpoint: `ws://127.0.0.1:${H4_WS_PORT}`,
      });
      const assetPk = new web3.PublicKey(lot.asset as string);
      const survived = (await conn.getAccountInfo(assetPk)) != null;
      if (survived) {
        force = await tryForceRecallAfterWarp(conn, web3, lot);
      } else {
        force = { skipped: true, reason: "lot accounts did not survive restart" };
      }
    } else {
      force = {
        skipped: true,
        reason: jumped
          ? "timestamp jumped but no lot"
          : "unix_timestamp did not advance by the 7d protocol window — slot-only change is fail",
      };
    }
    const genesisAlt =
      "Documented alternative on this binary: --slots-per-epoch (genesis only; ignored if ledger exists) and --warp-slot. No --warp-timestamp. Did not add a program writer.";
    return {
      hypothesis: "H4",
      command: { boot: bootCmd, restart: restartCmd },
      slot_ms_assumed: SLOT_MS_ASSUMED,
      warp_slot: WARP_SLOTS_7D,
      warp_slot_magnitudes: { d3: WARP_SLOTS_3D, d7: WARP_SLOTS_7D, d30: WARP_SLOTS_30D },
      clock_before: clockBefore,
      clock_after: clockAfter,
      unix_timestamp_delta_secs:
        Number((clockAfter as { unix_timestamp: bigint }).unix_timestamp) -
        Number((clockBefore as { unix_timestamp: bigint }).unix_timestamp),
      slot_delta:
        Number((clockAfter as { slot: bigint }).slot) -
        Number((clockBefore as { slot: bigint }).slot),
      timestamp_jumped_by_protocol_window:
        Number((clockAfter as { unix_timestamp: bigint }).unix_timestamp) -
          Number((clockBefore as { unix_timestamp: bigint }).unix_timestamp) >=
        RECALL_COOLDOWN_SECS,
      slot_only_change: slotOnly,
      lot: lot
        ? {
            asset: lot.asset,
            consign: lot.consign,
            core_owner_after_open: lot.core_owner_after_open,
          }
        : null,
      force_recall: force,
      alternative: genesisAlt,
      verdict:
        Number((clockAfter as { unix_timestamp: bigint }).unix_timestamp) -
          Number((clockBefore as { unix_timestamp: bigint }).unix_timestamp) >=
        RECALL_COOLDOWN_SECS
          ? (force as { force_recall?: { ok?: boolean }; moved_to_seller?: boolean })
              ?.moved_to_seller
            ? "unix_timestamp jumped and ForceRecall moved Core without ForceRecallRequestedAt"
            : "unix_timestamp jumped; ForceRecall result in force_recall"
          : "FAIL — unix_timestamp did not track --warp-slot (programs would still see wall time)",
    };
  } catch (e) {
    return {
      hypothesis: "H4",
      command: { boot: bootCmd, restart: restartCmd },
      clock_before: clockBefore,
      clock_after: clockAfter,
      verdict: "restart_failed",
      err: String(e),
    };
  } finally {
    stopValidator(child);
  }
}

function recommend(h1: Report, h2: Report, h3: Report, h4: Report): Report {
  const iso = (h1.isolation as Report) ?? {};
  const h1B = ((iso.B as Report | undefined)?.verdict) === "transfer_ok";
  const h1C = ((iso.C as Report | undefined)?.verdict) === "open_ok";
  const rustB = String((h3.rust_probe as Report | undefined)?.B ?? "").startsWith("B ok");
  const h4Moved = Boolean((h4.force_recall as Report | undefined)?.moved_to_seller);
  // Success path is program CPI (ForceRecall / OpenDirect), not client TransferV1.
  const inProcessWorks = h1B || h1C || rustB;
  const perWarp = {
    ForceRecallRequestedAt: inProcessWorks
      ? "LiteSVM setClock + shipping/stand v0 .so (same bytes 6d loaded) can replace the success path if TransferV1 now works; else stay"
      : h4Moved
        ? "validator ledger persist + unix_timestamp jump (no mid-run --reset for this case)"
        : "stay — named blocker in-process TransferV1 / validator unix_timestamp",
    ForceAuctionEndsAt: inProcessWorks
      ? "same as ForceRecall if TransferV1 works in-process (Ascending windows also Clock.unix_timestamp)"
      : h4Moved
        ? "validator timestamp travel (stand would have to persist ledger)"
        : "stay — same named blocker",
    ForceHoldClock: inProcessWorks
      ? "same as ForceAuctionEndsAt"
      : h4Moved
        ? "validator timestamp travel"
        : "stay — same named blocker",
  };
  return {
    per_warp: perWarp,
    prefer:
      inProcessWorks
        ? "in-process (shipping/stand v0 .so, no stand-vs-Devnet arch fork) — LiteSVM/Rust probe"
        : h4Moved
          ? "validator unix_timestamp (stand must persist ledger and drop mid-run --reset for those cases only)"
          : "none — warps stay; blocker is in-process TransferV1 and/or validator unix_timestamp",
    stand_impact: inProcessWorks
      ? "LiteSVM success → stand time suite in-process; validator keeps wire/ALT/CU. Not implemented this unit."
      : h4Moved
        ? "Validator timestamp success → stand must persist ledger and drop mid-run --reset for those cases only. Not implemented this unit."
        : "Neither → no stand change this step.",
    h2: h2.verdict,
    h3: h3.verdict,
    h4: h4.verdict,
  };
}

async function main(): Promise<void> {
  const report: Report = {
    unit: "S8-E 6d-2 TransferV1 / time-proof measure",
    command: "pnpm --dir svm/lab measure:6d2",
    hypotheses: [...MEASURE_6D2_HYPOTHESES],
    isolation_paths: [...MEASURE_6D2_ISOLATION],
  };
  const h1 = await runH1();
  report.H1 = h1;
  const h2 = await runH2(h1);
  report.H2 = h2;
  const h3 = runH3();
  report.H3 = h3;
  const h4 = await runH4();
  report.H4 = h4;
  report.recommendation = recommend(h1, h2, h3, h4);
  const outPath = "/tmp/kargain-6d2-measure.json";
  writeFileSync(outPath, JSON.stringify(report, (_, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  console.log(JSON.stringify(report, (_, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  console.error(`wrote ${outPath}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
