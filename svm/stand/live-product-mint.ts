/**
 * LIVE proof: product plan+send mint on the local validator via an injected
 * SvmSignAndSendPort, confirmed through the product {@link createSvmTxConfirmPort}
 * Outcome. Four cases: skip-preflight concurrency, preflight refuse concurrency,
 * expired blockhash, System-program Custom attribution (not NotOwner).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getBase58Encoder } from "@solana/kit";

import {
  classifyMintLandedError,
  planMintPassport,
  sendMintPassport,
} from "../../lib/passport/mint-passport.ts";
import { tokenIdFromBytes32 } from "../../lib/svm/event-payload-decode.ts";
import { systemProgramId } from "../../lib/svm/foreign-programs.ts";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../../lib/svm/rpc-max-supported-transaction-version.ts";
import { deriveSvmPdaForProgram } from "../../lib/svm/derive-pda.ts";
import { COMMERCIAL_ACTIVE } from "../../lib/web3/commercial-active.ts";
import type {
  CommercialRegistry,
  SvmCommercialActiveStack,
} from "../../lib/web3/commercial-active.ts";
import { svmActiveAccountFromAddress } from "../../lib/web3/active-account.ts";
import { createSvmTxConfirmPort } from "../../lib/web3/svm-tx-confirm.ts";
import { mintWalletStandardChain } from "../../lib/web3/wallet-standard-chain.ts";
import type { SvmSignAndSendPort } from "../../lib/web3/svm-write-adapter.ts";
import type { SvmWriteSubmission } from "../../lib/web3/write-outcome.ts";
import {
  withStandArtifactBindings,
  type StandArtifactBindings,
} from "./stand-artifact-bindings.ts";
import {
  airdrop,
  ensurePassportCommerceStack,
  NEXT_TOKEN_ID_OFFSET,
  RPC_DEFAULT,
  type Conn,
  type Kp,
} from "./stand-passport-commerce.ts";

const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lab/package.json"),
);
const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

export type LiveProductMintProof = {
  artifacts: StandArtifactBindings;
  happy: {
    signature: string;
    plannedTokenId: string;
    landedTokenId: string;
  };
  /** @deprecated alias — skip-preflight concurrency arm */
  concurrency: {
    cause: "mint_sequence_advanced";
    plannedTokenId: string;
    nextTokenIdAfter: string;
    landedErrorIndex: number;
  };
  concurrencySkipPreflight: {
    cause: "mint_sequence_advanced";
    plannedTokenId: string;
    nextTokenIdAfter: string;
    landedErrorIndex: number;
  };
  concurrencyPreflight: {
    cause: "mint_sequence_advanced";
    plannedTokenId: string;
  };
  expired: {
    kind: "expired";
    signature: string;
    lastValidBlockHeight: string;
    observedBlockHeight: string;
  };
  attribution: {
    kind: "landed_with_error";
    failingProgram: string;
    landedKind: "custom_unattributed";
    ordinal: number;
  };
};

function standRegistry(
  passportProgram: string,
  gatewayProgram: string,
): CommercialRegistry {
  const live = COMMERCIAL_ACTIVE[2_000_040_168];
  assert.ok(live && live.vm === "svm");
  return {
    ...COMMERCIAL_ACTIVE,
    [2_000_040_168]: {
      ...live,
      karPassport: passportProgram,
      bridgeGateway: gatewayProgram,
      walletStandardChain: mintWalletStandardChain("solana:devnet"),
    },
  };
}

function createStandSignAndSendPort(opts: {
  owner: Kp;
  connection: Conn;
  expectedChain: string;
  skipPreflight: boolean;
}): SvmSignAndSendPort {
  return {
    async signAndSendTransaction({ transaction, chain }) {
      if (chain !== opts.expectedChain) {
        throw new Error(
          `wrong_wallet_standard_chain: expected ${opts.expectedChain}, received ${chain}`,
        );
      }
      const tx = VersionedTransaction.deserialize(Buffer.from(transaction));
      tx.sign([opts.owner]);
      const signature = await opts.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: opts.skipPreflight,
        preflightCommitment: "confirmed",
      });
      return new Uint8Array(getBase58Encoder().encode(signature));
    },
  };
}

/** Sign and return signature without broadcasting — wire held for later send. */
function createWithholdPort(opts: {
  owner: Kp;
  expectedChain: string;
  hold: { wire: Uint8Array | null };
}): SvmSignAndSendPort {
  return {
    async signAndSendTransaction({ transaction, chain }) {
      if (chain !== opts.expectedChain) {
        throw new Error(
          `wrong_wallet_standard_chain: expected ${opts.expectedChain}, received ${chain}`,
        );
      }
      const tx = VersionedTransaction.deserialize(Buffer.from(transaction));
      tx.sign([opts.owner]);
      opts.hold.wire = tx.serialize();
      const sigBytes = tx.signatures[0];
      assert.ok(sigBytes && sigBytes.length === 64, "signed signature missing");
      // Port returns raw 64-byte sig; sendSvmInstruction base58-decodes to RPC string.
      return new Uint8Array(sigBytes);
    },
  };
}

async function fetchAccountData(conn: Conn, account: string) {
  const info = await conn.getAccountInfo(new PublicKey(account), "confirmed");
  if (info == null) {
    return {
      ok: false as const,
      cause: "account_not_found" as const,
      detail: account,
    };
  }
  return {
    ok: true as const,
    value: new Uint8Array(info.data),
  };
}

async function getSignatureStatuses(conn: Conn, signatures: string[]) {
  const { value } = await conn.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });
  return value;
}

async function fetchBlockhash(conn: Conn) {
  const latest = await conn.getLatestBlockhash("confirmed");
  return {
    ok: true as const,
    value: {
      blockhash: latest.blockhash,
      lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
    },
  };
}

function readNextTokenId(conn: Conn, config: InstanceType<typeof PublicKey>) {
  return conn.getAccountInfo(config, "confirmed").then((info) => {
    assert.ok(info, "passport config missing");
    const data = info.data as Buffer;
    return new Uint8Array(
      data.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
    );
  });
}

function bytesGt(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < 32; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

function productConfirmPort(conn: Conn, stack: SvmCommercialActiveStack) {
  return createSvmTxConfirmPort({
    stack,
    getSignatureStatuses: (sigs) => getSignatureStatuses(conn, sigs),
    getBlockHeight: async () => BigInt(await conn.getBlockHeight("confirmed")),
    getTransactionLogMessages: async (signature) => {
      const tx = await conn.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
      });
      return tx?.meta?.logMessages ?? null;
    },
    timeoutMs: 30_000,
  });
}

async function advancePastHeight(conn: Conn, lastValid: bigint): Promise<bigint> {
  for (let i = 0; i < 200; i++) {
    const tip = BigInt(await conn.getBlockHeight("confirmed"));
    if (tip > lastValid) return tip;
    await airdrop(conn, Keypair.generate(), 0.001);
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`tip did not pass lastValidBlockHeight ${lastValid}`);
}

export async function probeValidator(rpc = RPC_DEFAULT): Promise<boolean> {
  try {
    const c = new Connection(rpc, "confirmed");
    const v = await c.getVersion();
    return typeof v["solana-core"] === "string";
  } catch {
    return false;
  }
}

export async function runLiveProductMint(): Promise<LiveProductMintProof> {
  const conn = new Connection(RPC_DEFAULT, "confirmed");
  const stack = await ensurePassportCommerceStack(conn);
  const registry = standRegistry(
    stack.passportProgram.toBase58(),
    stack.gatewayProgram.toBase58(),
  );
  const ns = 2_000_040_168;
  const chain = "solana:devnet";
  const svmStack = registry[ns];
  assert.ok(svmStack && svmStack.vm === "svm");

  const payer = Keypair.generate();
  await airdrop(conn, payer, 5);
  const account = svmActiveAccountFromAddress(payer.publicKey.toBase58());

  const skipPort = createStandSignAndSendPort({
    owner: payer,
    connection: conn,
    expectedChain: chain,
    skipPreflight: true,
  });
  const preflightPort = createStandSignAndSendPort({
    owner: payer,
    connection: conn,
    expectedChain: chain,
    skipPreflight: false,
  });

  const fetchAccount = (addr: string) => fetchAccountData(conn, addr);
  const blockhash = async () => fetchBlockhash(conn);
  const confirmPort = productConfirmPort(conn, svmStack);

  const mintPorts = (port: SvmSignAndSendPort) =>
    ({
      writeEvmContract: async () => {
        throw new Error("EVM write unreachable on stand product mint");
      },
      registry,
      svmPort: port,
      fetchAccountData: fetchAccount,
      fetchBlockhash: blockhash,
      derivePda: deriveSvmPdaForProgram,
    }) as const;

  // --- Happy ---
  const planHappy = await planMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-happy",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planHappy.ok, true, "happy plan refused");
  if (!planHappy.ok || planHappy.vm !== "svm") throw new Error("unreachable");

  const sentHappy = await sendMintPassport({
    plan: planHappy,
    account,
    chainId: ns,
    ...mintPorts(skipPort),
  });
  assert.equal(sentHappy.ok, true, "happy send refused");
  if (!sentHappy.ok) throw new Error("unreachable");
  const happySub = sentHappy.submission as SvmWriteSubmission;

  const outcomeHappy = await confirmPort.confirmSubmission(happySub);
  assert.equal(
    outcomeHappy.kind,
    "landed_ok",
    `happy confirm kind=${outcomeHappy.kind}`,
  );

  const plannedTokenId = planHappy.plan.plannedTokenId;
  const nextAfterHappy = await readNextTokenId(conn, stack.passportConfig);
  assert.ok(
    bytesGt(nextAfterHappy, planHappy.plan.plannedNextTokenId),
    "next_token_id must advance past happy planned id",
  );

  // --- (1) skipPreflight: plan A, land B, send stale A → landed InvalidSeeds ---
  const planA = await planMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-stale-a",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planA.ok, true);
  if (!planA.ok || planA.vm !== "svm") throw new Error("unreachable");

  const planB = await planMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-race-b",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planB.ok, true);
  if (!planB.ok || planB.vm !== "svm") throw new Error("unreachable");

  const sentB = await sendMintPassport({
    plan: planB,
    account,
    chainId: ns,
    ...mintPorts(skipPort),
  });
  assert.equal(sentB.ok, true, "B send refused");
  if (!sentB.ok) throw new Error("unreachable");
  const outcomeB = await confirmPort.confirmSubmission(
    sentB.submission as SvmWriteSubmission,
  );
  assert.equal(outcomeB.kind, "landed_ok", `B confirm kind=${outcomeB.kind}`);

  const sentA = await sendMintPassport({
    plan: planA,
    account,
    chainId: ns,
    ...mintPorts(skipPort),
  });
  assert.equal(sentA.ok, true, "A send refused");
  if (!sentA.ok) throw new Error("unreachable");

  const outcomeA = await confirmPort.confirmSubmission(
    sentA.submission as SvmWriteSubmission,
  );
  assert.equal(
    outcomeA.kind,
    "landed_with_error",
    `A confirm kind=${outcomeA.kind}`,
  );
  if (outcomeA.kind !== "landed_with_error") throw new Error("unreachable");
  assert.ok(outcomeA.landed, "landed InstructionError must parse");
  assert.equal(outcomeA.landed.kind, "native");
  assert.equal(outcomeA.landed.name, "InvalidSeeds");

  const freshNext = await readNextTokenId(conn, stack.passportConfig);
  const classified = classifyMintLandedError(
    outcomeA.landed,
    planA.plan.plannedNextTokenId,
    freshNext,
  );
  assert.equal(classified, "mint_sequence_advanced");

  const concurrencySkipPreflight = {
    cause: "mint_sequence_advanced" as const,
    plannedTokenId: planA.plan.plannedTokenId,
    nextTokenIdAfter: tokenIdFromBytes32(freshNext),
    landedErrorIndex: outcomeA.landed.index,
  };

  // --- (2) skipPreflight false: plan C, land D, send stale C → send refuse ---
  const planC = await planMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-stale-c",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planC.ok, true);
  if (!planC.ok || planC.vm !== "svm") throw new Error("unreachable");

  const planD = await planMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-race-d",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planD.ok, true);
  if (!planD.ok || planD.vm !== "svm") throw new Error("unreachable");

  const sentD = await sendMintPassport({
    plan: planD,
    account,
    chainId: ns,
    ...mintPorts(skipPort),
  });
  assert.equal(sentD.ok, true);
  if (!sentD.ok) throw new Error("unreachable");
  const outcomeD = await confirmPort.confirmSubmission(
    sentD.submission as SvmWriteSubmission,
  );
  assert.equal(outcomeD.kind, "landed_ok");

  const sentC = await sendMintPassport({
    plan: planC,
    account,
    chainId: ns,
    ...mintPorts(preflightPort),
  });
  assert.equal(sentC.ok, false, "stale C must refuse at preflight send");
  const nextAfterC = await readNextTokenId(conn, stack.passportConfig);
  assert.ok(
    bytesGt(nextAfterC, planC.plan.plannedNextTokenId),
    "next advanced after D; C refuse is concurrency",
  );

  // --- (3) expired: sign+withhold, tip past lastValid, then send + confirm ---
  const planExp = await planMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-expired",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planExp.ok, true);
  if (!planExp.ok || planExp.vm !== "svm") throw new Error("unreachable");

  const hold: { wire: Uint8Array | null } = { wire: null };
  const withholdPort = createWithholdPort({
    owner: payer,
    expectedChain: chain,
    hold,
  });
  const sentExp = await sendMintPassport({
    plan: planExp,
    account,
    chainId: ns,
    ...mintPorts(withholdPort),
  });
  if (!sentExp.ok) {
    assert.fail(
      `withhold sign refused: cause=${sentExp.cause} detail=${sentExp.detail}`,
    );
  }
  const expSub = sentExp.submission as SvmWriteSubmission;
  assert.ok(hold.wire, "wire must be withheld");

  const observed = await advancePastHeight(conn, expSub.lastValidBlockHeight);
  await conn.sendRawTransaction(hold.wire!, {
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });
  const outcomeExp = await confirmPort.confirmSubmission(expSub);
  assert.equal(
    outcomeExp.kind,
    "expired",
    `expired confirm kind=${outcomeExp.kind} tip=${observed}`,
  );
  if (outcomeExp.kind !== "expired") throw new Error("unreachable");

  // --- (4) Attribution: underfunded payer → System Custom, not NotOwner ---
  const broke = Keypair.generate();
  await airdrop(conn, broke, 0.001);
  const brokeAccount = svmActiveAccountFromAddress(broke.publicKey.toBase58());
  const brokePort = createStandSignAndSendPort({
    owner: broke,
    connection: conn,
    expectedChain: chain,
    skipPreflight: true,
  });
  const planBroke = await planMintPassport({
    account: brokeAccount,
    chainId: ns,
    uri: "ar://product-mint-stand-broke",
    registry,
    fetchAccountData: fetchAccount,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(planBroke.ok, true);
  if (!planBroke.ok || planBroke.vm !== "svm") throw new Error("unreachable");

  const sentBroke = await sendMintPassport({
    plan: planBroke,
    account: brokeAccount,
    chainId: ns,
    ...mintPorts(brokePort),
  });
  assert.equal(sentBroke.ok, true, "broke send should submit");
  if (!sentBroke.ok) throw new Error("unreachable");
  const outcomeBroke = await confirmPort.confirmSubmission(
    sentBroke.submission as SvmWriteSubmission,
  );
  assert.equal(outcomeBroke.kind, "landed_with_error");
  if (outcomeBroke.kind !== "landed_with_error") throw new Error("unreachable");
  const systemId = systemProgramId();
  assert.equal(
    outcomeBroke.failingProgram,
    systemId,
    `failingProgram must be System, got ${outcomeBroke.failingProgram}`,
  );
  assert.ok(outcomeBroke.landed);
  assert.equal(outcomeBroke.landed.kind, "custom_unattributed");
  if (outcomeBroke.landed.kind !== "custom_unattributed") {
    throw new Error("unreachable");
  }

  return withStandArtifactBindings({
    happy: {
      signature: happySub.signature,
      plannedTokenId,
      landedTokenId: plannedTokenId,
    },
    concurrency: concurrencySkipPreflight,
    concurrencySkipPreflight,
    concurrencyPreflight: {
      cause: "mint_sequence_advanced",
      plannedTokenId: planC.plan.plannedTokenId,
    },
    expired: {
      kind: "expired",
      signature: outcomeExp.signature,
      lastValidBlockHeight: String(outcomeExp.lastValidBlockHeight),
      observedBlockHeight: String(outcomeExp.observedBlockHeight),
    },
    attribution: {
      kind: "landed_with_error",
      failingProgram: outcomeBroke.failingProgram!,
      landedKind: "custom_unattributed",
      ordinal: outcomeBroke.landed.ordinal,
    },
  });
}
