/**
 * LIVE proof: product {@link executeMintPassport} on the local validator via an
 * injected SvmSignAndSendPort (U9.1 shape). Happy path + mint_sequence_advanced.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getBase58Encoder } from "@solana/kit";

import { executeMintPassport } from "../../lib/passport/mint-passport.ts";
import { tokenIdFromBytes32 } from "../../lib/svm/event-payload-decode.ts";
import { deriveSvmPdaForProgram } from "../../lib/svm/derive-pda.ts";
import { COMMERCIAL_ACTIVE } from "../../lib/web3/commercial-active.ts";
import type { CommercialRegistry } from "../../lib/web3/commercial-active.ts";
import { svmActiveAccountFromAddress } from "../../lib/web3/active-account.ts";
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
  const height = await conn.getBlockHeight("confirmed");
  return {
    ok: true as const,
    value: {
      blockhash: latest.blockhash,
      lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
    },
    // height unused — keep shape for expiry checks if adapter compares
    _tip: BigInt(height),
  };
}

function readNextTokenId(conn: Conn, config: InstanceType<typeof PublicKey>) {
  return conn.getAccountInfo(config, "confirmed").then((info) => {
    assert.ok(info, "passport config missing");
    const data = info.data as Buffer;
    return Buffer.from(
      data.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
    );
  });
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
  const blockhash = async () => {
    const r = await fetchBlockhash(conn);
    return { ok: true as const, value: r.value };
  };

  // --- Happy path ---
  const happy = await executeMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-happy",
    writeEvmContract: async () => {
      throw new Error("EVM write unreachable on stand product mint");
    },
    registry,
    svmPort: port,
    fetchAccountData: fetchAccount,
    getSignatureStatuses: getStatuses,
    fetchBlockhash: blockhash,
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(happy.ok, true, `happy mint refused: ${JSON.stringify(happy)}`);
  if (!happy.ok) throw new Error("unreachable");
  assert.ok(happy.plannedTokenId, "plannedTokenId required");
  const landedTokenId = happy.plannedTokenId;

  const nextAfterHappy = await readNextTokenId(conn, stack.passportConfig);
  assert.notEqual(
    tokenIdFromBytes32(nextAfterHappy),
    landedTokenId,
    "next_token_id must advance past landed mint",
  );
  assert.ok(
    Buffer.compare(nextAfterHappy, tokenIdToBytes32Buf(landedTokenId)) > 0,
    "next_token_id bytes must be greater than planned",
  );

  // --- Concurrency: stale planned next_token_id ---
  const stalePlanned = tokenIdToBytes32Buf(landedTokenId);
  const concurrency = await executeMintPassport({
    account,
    chainId: ns,
    uri: "ar://product-mint-stand-stale",
    writeEvmContract: async () => {
      throw new Error("EVM write unreachable on stand product mint");
    },
    registry,
    svmPort: port,
    fetchAccountData: fetchAccount,
    getSignatureStatuses: getStatuses,
    fetchBlockhash: blockhash,
    plannedNextTokenIdOverride: new Uint8Array(stalePlanned),
    derivePda: deriveSvmPdaForProgram,
  });
  assert.equal(concurrency.ok, false);
  if (concurrency.ok) throw new Error("unreachable");
  assert.equal(concurrency.cause, "mint_sequence_advanced");

  const nextAfterStale = await readNextTokenId(conn, stack.passportConfig);

  return withStandArtifactBindings({
    happy: {
      signature: happy.signature,
      plannedTokenId: landedTokenId,
      landedTokenId,
    },
    concurrency: {
      cause: "mint_sequence_advanced",
      plannedTokenId: landedTokenId,
      nextTokenIdAfter: tokenIdFromBytes32(nextAfterStale),
    },
  });
}

function tokenIdToBytes32Buf(tokenId: string): Buffer {
  if (!/^\d+$/.test(tokenId)) throw new Error(`bad tokenId ${tokenId}`);
  let value = BigInt(tokenId);
  const bytes = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}
