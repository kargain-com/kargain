/**
 * LIVE proof: product plan+send mint on the local validator via an injected
 * SvmSignAndSendPort, confirmed through the product {@link createSvmTxConfirmPort}
 * Outcome. Happy path + real A/B concurrency (no plannedNextTokenIdOverride).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getBase58Encoder } from "@solana/kit";

import {
  classifyMintLandedErrorFromRaw,
  planMintPassport,
  sendMintPassport,
} from "../../lib/passport/mint-passport.ts";
import { tokenIdFromBytes32 } from "../../lib/svm/event-payload-decode.ts";
import { deriveSvmPdaForProgram } from "../../lib/svm/derive-pda.ts";
import { COMMERCIAL_ACTIVE } from "../../lib/web3/commercial-active.ts";
import type { CommercialRegistry } from "../../lib/web3/commercial-active.ts";
import { svmActiveAccountFromAddress } from "../../lib/web3/active-account.ts";
import { parseSvmLandedInstructionError } from "../../lib/web3/svm-landed-error.ts";
import { createSvmTxConfirmPort } from "../../lib/web3/svm-tx-confirm.ts";
import { mintWalletStandardChain } from "../../lib/web3/wallet-standard-chain.ts";
import type { SvmSignAndSendPort } from "../../lib/web3/svm-write-adapter.ts";
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
  concurrency: {
    cause: "mint_sequence_advanced";
    plannedTokenId: string;
    nextTokenIdAfter: string;
    landedErrorIndex: number;
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
        skipPreflight: true,
        preflightCommitment: "confirmed",
      });
      return new Uint8Array(getBase58Encoder().encode(signature));
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

  const payer = Keypair.generate();
  await airdrop(conn, payer, 5);
  const account = svmActiveAccountFromAddress(payer.publicKey.toBase58());
  const port = createStandSignAndSendPort({
    owner: payer,
    connection: conn,
    expectedChain: chain,
  });

  const fetchAccount = (addr: string) => fetchAccountData(conn, addr);
  const getStatuses = (sigs: string[]) => getSignatureStatuses(conn, sigs);
  const blockhash = async () => fetchBlockhash(conn);
  const confirmPort = createSvmTxConfirmPort({
    getSignatureStatuses: getStatuses,
    timeoutMs: 30_000,
  });

  const mintPorts = {
    writeEvmContract: async () => {
      throw new Error("EVM write unreachable on stand product mint");
    },
    registry,
    svmPort: port,
    fetchAccountData: fetchAccount,
    fetchBlockhash: blockhash,
    derivePda: deriveSvmPdaForProgram,
  } as const;

  // --- Happy: plan + send + product confirm Outcome ---
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
    ...mintPorts,
  });
  assert.equal(sentHappy.ok, true, "happy send refused");
  if (!sentHappy.ok) throw new Error("unreachable");

  const outcomeHappy = await confirmPort.confirmSignature(sentHappy.signature);
  assert.equal(
    outcomeHappy.kind,
    "landed_ok",
    `happy confirm kind=${outcomeHappy.kind}`,
  );
  if (outcomeHappy.kind !== "landed_ok") throw new Error("unreachable");

  const plannedTokenId = planHappy.plan.plannedTokenId;
  const nextAfterHappy = await readNextTokenId(conn, stack.passportConfig);
  assert.ok(
    bytesGt(nextAfterHappy, planHappy.plan.plannedNextTokenId),
    "next_token_id must advance past happy planned id",
  );

  // --- Concurrency: plan A, land B, send stale A ---
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
  assert.equal(
    planB.plan.plannedTokenId,
    planA.plan.plannedTokenId,
    "A and B must share the same planned next before either lands",
  );

  const sentB = await sendMintPassport({
    plan: planB,
    account,
    chainId: ns,
    ...mintPorts,
  });
  assert.equal(sentB.ok, true, "B send refused");
  if (!sentB.ok) throw new Error("unreachable");
  const outcomeB = await confirmPort.confirmSignature(sentB.signature);
  assert.equal(outcomeB.kind, "landed_ok", `B confirm kind=${outcomeB.kind}`);

  const sentA = await sendMintPassport({
    plan: planA,
    account,
    chainId: ns,
    ...mintPorts,
  });
  assert.equal(sentA.ok, true, "A send refused");
  if (!sentA.ok) throw new Error("unreachable");

  const outcomeA = await confirmPort.confirmSignature(sentA.signature);
  assert.equal(
    outcomeA.kind,
    "landed_with_error",
    `A confirm kind=${outcomeA.kind}`,
  );
  if (outcomeA.kind !== "landed_with_error") throw new Error("unreachable");

  const landed = parseSvmLandedInstructionError(outcomeA.error);
  assert.ok(landed, "landed InstructionError must parse");
  assert.equal(landed!.kind, "native");
  assert.equal(landed!.name, "InvalidSeeds");

  const freshNext = await readNextTokenId(conn, stack.passportConfig);
  const classified = classifyMintLandedErrorFromRaw(
    outcomeA.error,
    planA.plan.plannedNextTokenId,
    freshNext,
  );
  assert.equal(classified, "mint_sequence_advanced");

  return withStandArtifactBindings({
    happy: {
      signature: sentHappy.signature,
      plannedTokenId,
      landedTokenId: plannedTokenId,
    },
    concurrency: {
      cause: "mint_sequence_advanced",
      plannedTokenId: planA.plan.plannedTokenId,
      nextTokenIdAfter: tokenIdFromBytes32(freshNext),
      landedErrorIndex: landed!.index,
    },
  });
}
