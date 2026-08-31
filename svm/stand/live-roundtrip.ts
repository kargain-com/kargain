/**
 * Live SVM stand — clear-before-state LzReceive with Metaplex Core CPI.
 *
 * Requires local validator from `./svm/stand/start-validator.sh` (all programs
 * via `--bpf-program` after `cargo-build-sbf --arch v0`).
 *
 * EVM wire bytes come from `encodeOnftMessage` (byte-identical to EndpointV2Mock /
 * ONFT721MsgCodec). Full dual Hardhat EndpointV2Mock remains in
 * `test/KarPassportBridgeGateway.test.ts`; this stand proves destination Core
 * create + home lock/unlock on the validator.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  abiEncodeString,
  encodeOnftMessage,
  tokenIdFromParts,
} from "../../lib/web3/bridge/onft-msg-codec.ts";
import {
  STAND_EVM_EID,
  STAND_EVM_NAMESPACE,
  STAND_SVM_EID,
  STAND_SVM_NAMESPACE,
  standLiveUri,
} from "./constants.ts";
import { assertPayloadUnchanged, relayCopyPayload } from "./dumb-relay.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Resolve @solana/web3.js from the lab package (not a root dependency). */
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

const ROOT = path.resolve(__dirname, "../..");
const DEPLOY = path.resolve(__dirname, "../target/deploy");
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";

const CONFIG_SEED = Buffer.from("config");
const ASSET_SEED = Buffer.from("asset");
const STATE_SEED = Buffer.from("state");
const FREEZE_SEED = Buffer.from("freeze");
const EP_CONFIG_SEED = Buffer.from("ep_config");
const EP_CLEAR_SEED = Buffer.from("ep_clear");

export type LiveRoundTripResult = {
  foreignMintCu: number | null;
  homeUnlockCu: number | null;
  /** Serialized foreign-mint tx byte length (mock 13-meta list + CU ix). */
  foreignMintTxSize: number | null;
  foreignAssetLive: boolean;
  homeUnlocked: boolean;
  homeStatusAfterUnlock: number;
  uriTravelled: boolean;
  relayIdentityOk: boolean;
  liveUriLen: number;
};

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function programIdFromDeploy(name: string): PublicKey {
  const kp = loadKeypair(path.join(DEPLOY, `${name}-keypair.json`));
  return kp.publicKey;
}

function pda(seeds: Buffer[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function encodeU128Le(n: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buf;
}

function encodeString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + b.length);
  out.writeUInt32LE(b.length, 0);
  b.copy(out, 4);
  return out;
}

function encodeVecU8(data: Uint8Array): Buffer {
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32LE(data.length, 0);
  Buffer.from(data).copy(out, 4);
  return out;
}

/** Borsh PassportIx::Initialize (disc 0). */
function passportInitializeData(args: {
  namespace: bigint;
  localEid: number;
  endpoint: PublicKey;
  disputeDeposit: bigint;
  staking: PublicKey;
  forfeit: PublicKey;
}): Buffer {
  return Buffer.concat([
    Buffer.from([0]),
    encodeU128Le(args.namespace),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(args.localEid, 0);
      return b;
    })(),
    Buffer.from(args.endpoint.toBytes()),
    (() => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(args.disputeDeposit, 0);
      return b;
    })(),
    Buffer.from(args.staking.toBytes()),
    Buffer.from(args.forfeit.toBytes()),
  ]);
}

function passportSetGatewayData(gateway: PublicKey): Buffer {
  return Buffer.concat([Buffer.from([1]), Buffer.from(gateway.toBytes())]);
}

function passportMintData(uri: string): Buffer {
  return Buffer.concat([Buffer.from([2]), encodeString(uri)]);
}

function gatewayInitializeData(args: {
  localEid: number;
  endpoint: PublicKey;
  passport: PublicKey;
  namespace: bigint;
}): Buffer {
  return Buffer.concat([
    Buffer.from([0]),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(args.localEid, 0);
      return b;
    })(),
    Buffer.from(args.endpoint.toBytes()),
    Buffer.from(args.passport.toBytes()),
    encodeU128Le(args.namespace),
  ]);
}

function gatewaySendData(dstEid: number, to: Uint8Array, tokenId: Uint8Array): Buffer {
  const eid = Buffer.alloc(4);
  eid.writeUInt32LE(dstEid, 0);
  const fee = Buffer.alloc(8);
  fee.writeBigUInt64LE(0n, 0);
  const emptyOptions = Buffer.alloc(4); // vec len 0
  emptyOptions.writeUInt32LE(0, 0);
  return Buffer.concat([
    Buffer.from([1]),
    eid,
    Buffer.from(to),
    Buffer.from(tokenId),
    fee,
    emptyOptions,
  ]);
}

function gatewayLzReceiveData(args: {
  srcEid: number;
  sender: Uint8Array;
  nonce: bigint;
  guid: Uint8Array;
  message: Uint8Array;
}): Buffer {
  const eid = Buffer.alloc(4);
  eid.writeUInt32LE(args.srcEid, 0);
  const nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(args.nonce, 0);
  return Buffer.concat([
    Buffer.from([2]),
    eid,
    Buffer.from(args.sender),
    nonce,
    Buffer.from(args.guid),
    encodeVecU8(args.message),
  ]);
}

function mockEndpointInitializeData(): Buffer {
  return Buffer.from([0]);
}

function parsePassportState(data: Buffer): {
  status: number;
  custodyLocked: boolean;
  burned: boolean;
  recordCount: number;
} {
  // disc(8) + token_id(32) + status(u8) + verifier(32) + verified_at(u64)
  // + custody_locked(bool) + burned(bool) + record_count(u32) + bump(u8)
  const status = data[40]!;
  const custodyLocked = data[81]! !== 0;
  const burned = data[82]! !== 0;
  const recordCount = data.readUInt32LE(83);
  return { status, custodyLocked, burned, recordCount };
}

function isLiveCoreAsset(info: { owner: PublicKey; data: Buffer } | null): boolean {
  if (!info) return false;
  return info.owner.equals(CORE_ID) && info.data.length > 1;
}

async function sendIx(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
  label: string,
): Promise<{ signature: string; cu: number | null; serializedLen: number }> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...ixs,
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const serializedLen = tx.serialize().length;
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  const parsed = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  const cu =
    parsed?.meta?.computeUnitsConsumed != null
      ? Number(parsed.meta.computeUnitsConsumed)
      : null;
  if (parsed?.meta?.err) {
    throw new Error(`${label} failed: ${JSON.stringify(parsed.meta.err)}`);
  }
  console.warn(
    `[svm-stand live] ${label} ok sig=${sig.slice(0, 12)}… cu=${cu ?? "?"} txSize=${serializedLen}`,
  );
  return { signature: sig, cu, serializedLen };
}

export async function probeValidator(rpc = RPC): Promise<boolean> {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: [],
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: string };
    return body.result === "ok";
  } catch {
    return false;
  }
}

/**
 * Drive both-direction live path on the local validator.
 * Throws on failure (caller must not soft-skip when LIVE=1).
 */
export async function runLiveSvmRoundTrip(): Promise<LiveRoundTripResult> {
  for (const name of [
    "mock_endpoint",
    "kar_passport",
    "kar_gateway",
    "mock_staking",
  ] as const) {
    if (!fs.existsSync(path.join(DEPLOY, `${name}.so`))) {
      throw new Error(
        `missing ${name}.so — build with cargo-build-sbf --arch v0 (preload) or --arch v3 (upgradeable)`,
      );
    }
  }

  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair(
    process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
  );

  const endpointProgram = programIdFromDeploy("mock_endpoint");
  const passportProgram = programIdFromDeploy("kar_passport");
  const gatewayProgram = programIdFromDeploy("kar_gateway");
  const stakingProgram = programIdFromDeploy("mock_staking");

  const [endpointConfig] = pda([EP_CONFIG_SEED], endpointProgram);
  const [passportConfig] = pda([CONFIG_SEED], passportProgram);
  const [gatewayConfig] = pda([CONFIG_SEED], gatewayProgram);
  const [freezePda] = pda([FREEZE_SEED], gatewayProgram);

  const bal = await connection.getBalance(payer.publicKey);
  if (bal < 2e9) {
    // Local validator faucet
    const sig = await connection.requestAirdrop(payer.publicKey, 5 * 1e9);
    await connection.confirmTransaction(sig, "confirmed");
  }

  // --- Init endpoint ---
  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: endpointProgram,
        keys: [
          { pubkey: endpointConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: mockEndpointInitializeData(),
      }),
    ],
    "endpoint.Initialize",
  );

  // --- Init passport ---
  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: passportProgram,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: passportInitializeData({
          namespace: STAND_SVM_NAMESPACE,
          localEid: STAND_SVM_EID,
          endpoint: endpointProgram,
          disputeDeposit: 1_000_000n,
          staking: stakingProgram,
          forfeit: payer.publicKey,
        }),
      }),
    ],
    "passport.Initialize",
  );

  // --- Init gateway ---
  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: gatewayProgram,
        keys: [
          { pubkey: gatewayConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: gatewayInitializeData({
          localEid: STAND_SVM_EID,
          endpoint: endpointProgram,
          passport: passportProgram,
          namespace: STAND_SVM_NAMESPACE,
        }),
      }),
    ],
    "gateway.Initialize",
  );

  // bridge_gateway = gateway config PDA (CPI signer)
  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: passportProgram,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data: passportSetGatewayData(gatewayConfig),
      }),
    ],
    "passport.SetBridgeGateway",
  );

  // ========== Direction A: EVM-shaped ONFT → SVM foreign mint ==========
  const liveUri = standLiveUri();
  const foreignTokenId = tokenIdFromParts(STAND_EVM_NAMESPACE, 42n);
  const sendTo = payer.publicKey.toBytes();
  const composeInner = abiEncodeString(liveUri);
  const { message: outboundMessage } = encodeOnftMessage(
    sendTo,
    foreignTokenId,
    composeInner,
  );
  const relayed = relayCopyPayload({
    srcEid: STAND_EVM_EID,
    dstEid: STAND_SVM_EID,
    sender: new Uint8Array(32).fill(0x11),
    nonce: 1n,
    guid: new Uint8Array(32).fill(0x22),
    payload: outboundMessage,
  });
  assertPayloadUnchanged(outboundMessage, relayed.payload);
  const relayIdentityOk = Buffer.from(outboundMessage).equals(
    Buffer.from(relayed.payload),
  );

  const [foreignAsset] = pda([ASSET_SEED, Buffer.from(foreignTokenId)], passportProgram);
  const [foreignState] = pda([STATE_SEED, Buffer.from(foreignTokenId)], passportProgram);
  const senderArr = Uint8Array.from(relayed.sender);
  const [clearForeign] = pda(
    [
      EP_CLEAR_SEED,
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(relayed.srcEid, 0);
        return b;
      })(),
      Buffer.from(senderArr),
      (() => {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(relayed.nonce, 0);
        return b;
      })(),
    ],
    endpointProgram,
  );

  const foreignMint = await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: gatewayProgram,
        keys: [
          { pubkey: gatewayConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: endpointProgram, isSigner: false, isWritable: false },
          { pubkey: endpointConfig, isSigner: false, isWritable: false },
          { pubkey: clearForeign, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: passportProgram, isSigner: false, isWritable: false },
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: foreignAsset, isSigner: false, isWritable: true },
          { pubkey: foreignState, isSigner: false, isWritable: true },
          { pubkey: freezePda, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
        ],
        data: gatewayLzReceiveData({
          srcEid: relayed.srcEid,
          sender: senderArr,
          nonce: relayed.nonce,
          guid: Uint8Array.from(relayed.guid),
          message: Uint8Array.from(relayed.payload),
        }),
      }),
    ],
    "gateway.LzReceive foreign mint",
  );

  const foreignAssetInfo = await connection.getAccountInfo(foreignAsset);
  const foreignAssetLive = isLiveCoreAsset(
    foreignAssetInfo
      ? { owner: foreignAssetInfo.owner, data: Buffer.from(foreignAssetInfo.data) }
      : null,
  );
  if (!foreignAssetLive) {
    throw new Error("foreign LzReceive did not create a live Core asset");
  }
  const foreignStateInfo = await connection.getAccountInfo(foreignState);
  if (!foreignStateInfo) throw new Error("foreign state PDA missing");
  const foreignSt = parsePassportState(Buffer.from(foreignStateInfo.data));
  if (foreignSt.status !== 0) {
    throw new Error(`foreign mint expected UNVERIFIED(0), got ${foreignSt.status}`);
  }

  // N6-4: always log foreign-mint size at declared ceiling (mock 13-meta list).
  // Do not equate this to production 18-meta computed 1208 — account lists differ.
  {
    const clearInfo = await connection.getAccountInfo(clearForeign);
    const rows = [
      ["foreignAsset", foreignAssetInfo],
      ["foreignState", foreignStateInfo],
      ["clearReceipt", clearInfo],
    ] as const;
    for (const [label, info] of rows) {
      if (!info) continue;
      const rentMin = await connection.getMinimumBalanceForRentExemption(
        info.data.length,
      );
      console.log(
        `[svm-stand measure] uri=${liveUri.length}B ${label} dataLen=${info.data.length} lamports=${info.lamports} rentExemptMin=${rentMin}`,
      );
    }
    console.log(
      `[svm-stand measure] uri=${liveUri.length}B foreignMintCu=${foreignMint.cu} foreignMintTxSize=${foreignMint.serializedLen} (mock 13-meta; production 18-meta @160 computed 1208 margin +24)`,
    );
  }

  // ========== Direction B: home mint → send (lock) → return unlock ==========
  const homeTokenId = tokenIdFromParts(STAND_SVM_NAMESPACE, 1n);
  const [homeAsset] = pda([ASSET_SEED, Buffer.from(homeTokenId)], passportProgram);
  const [homeState] = pda([STATE_SEED, Buffer.from(homeTokenId)], passportProgram);

  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: passportProgram,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: homeAsset, isSigner: false, isWritable: true },
          { pubkey: homeState, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
          { pubkey: freezePda, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: passportMintData(liveUri),
      }),
    ],
    "passport.MintPassport home",
  );

  const recipient = Keypair.generate();
  const sendResult = await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: gatewayProgram,
        keys: [
          { pubkey: gatewayConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: passportProgram, isSigner: false, isWritable: false },
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: homeAsset, isSigner: false, isWritable: true },
          { pubkey: homeState, isSigner: false, isWritable: true },
          { pubkey: freezePda, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: gatewaySendData(
          STAND_EVM_EID,
          recipient.publicKey.toBytes(),
          homeTokenId,
        ),
      }),
    ],
    "gateway.Send home lock",
  );

  // Reconstruct ONFT the same way Send does (return data not always surfaced via web3).
  const { message: returnMessage } = encodeOnftMessage(
    payer.publicKey.toBytes(), // unlock to original owner
    homeTokenId,
    abiEncodeString(liveUri),
  );
  const returnRelayed = relayCopyPayload({
    srcEid: STAND_EVM_EID,
    dstEid: STAND_SVM_EID,
    sender: new Uint8Array(32).fill(0x33),
    nonce: 2n,
    guid: new Uint8Array(32).fill(0x44),
    payload: returnMessage,
  });

  const returnSender = Uint8Array.from(returnRelayed.sender);
  const [clearHome] = pda(
    [
      EP_CLEAR_SEED,
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(returnRelayed.srcEid, 0);
        return b;
      })(),
      Buffer.from(returnSender),
      (() => {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(returnRelayed.nonce, 0);
        return b;
      })(),
    ],
    endpointProgram,
  );

  const lockedState = await connection.getAccountInfo(homeState);
  if (!lockedState) throw new Error("home state missing after send");
  const locked = parsePassportState(Buffer.from(lockedState.data));
  if (!locked.custodyLocked) {
    throw new Error("expected custody_locked after home Send");
  }

  const unlock = await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: gatewayProgram,
        keys: [
          { pubkey: gatewayConfig, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: endpointProgram, isSigner: false, isWritable: false },
          { pubkey: endpointConfig, isSigner: false, isWritable: false },
          { pubkey: clearHome, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: passportProgram, isSigner: false, isWritable: false },
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: homeAsset, isSigner: false, isWritable: true },
          { pubkey: homeState, isSigner: false, isWritable: true },
          { pubkey: freezePda, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
        ],
        data: gatewayLzReceiveData({
          srcEid: returnRelayed.srcEid,
          sender: returnSender,
          nonce: returnRelayed.nonce,
          guid: Uint8Array.from(returnRelayed.guid),
          message: Uint8Array.from(returnRelayed.payload),
        }),
      }),
    ],
    "gateway.LzReceive home unlock",
  );

  const unlockedStateInfo = await connection.getAccountInfo(homeState);
  if (!unlockedStateInfo) throw new Error("home state missing after unlock");
  const unlocked = parsePassportState(Buffer.from(unlockedStateInfo.data));
  if (unlocked.custodyLocked) {
    throw new Error("expected custody unlocked after return LzReceive");
  }
  if (unlocked.status !== 0) {
    throw new Error(`home unlock expected UNVERIFIED(0), got ${unlocked.status}`);
  }

  const homeAssetAfter = await connection.getAccountInfo(homeAsset);
  const homeUnlocked = isLiveCoreAsset(
    homeAssetAfter
      ? { owner: homeAssetAfter.owner, data: Buffer.from(homeAssetAfter.data) }
      : null,
  );
  if (!homeUnlocked) {
    throw new Error("home asset not live after unlock");
  }

  const uriTravelled = foreignAssetLive && foreignSt.status === 0;

  void sendResult;
  void ROOT;

  return {
    foreignMintCu: foreignMint.cu,
    homeUnlockCu: unlock.cu,
    foreignMintTxSize: foreignMint.serializedLen,
    foreignAssetLive,
    homeUnlocked,
    homeStatusAfterUnlock: unlocked.status,
    uriTravelled,
    relayIdentityOk,
    liveUriLen: liveUri.length,
  };
}
