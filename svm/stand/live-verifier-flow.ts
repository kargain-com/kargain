/**
 * S5 live verifier flow on local stand validator.
 * join → mint passport → verify → leave → close_pass → wait unbond → claim.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  testnetMinStakeFloorLamports,
  testnetMinStakeLamports,
  testnetMinStakePinRecord,
} from "../../lib/web3/min-stake-sol.ts";
import {
  STAKE_ACCOUNT_SPACE,
  assertClaimSettled,
  assertPassClosed,
  assertPassportVerified,
  assertStakeActive,
  assertStakeClearedAfterClaim,
  assertUnbondNotReady,
  isLiveCoreAsset,
} from "../../scripts/lib/svm-verifier-lifecycle-asserts.ts";
import {
  STAND_SVM_EID,
  STAND_SVM_NAMESPACE,
} from "./constants.ts";
import { withStandArtifactBindings } from "./stand-artifact-bindings.ts";
import type { StandArtifactBindings } from "./stand-artifact-bindings.ts";
import { tokenIdFromParts } from "../../lib/web3/bridge/onft-msg-codec.ts";
import type {
  StandConnection,
  StandKeypair,
  StandPublicKey,
  StandTransactionInstruction,
} from "./solana-web3-types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

const DEPLOY = path.resolve(__dirname, "../target/deploy");
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";

const CONFIG_SEED = Buffer.from("config");
const STAKE_SEED = Buffer.from("stake");
const ASSET_SEED = Buffer.from("asset");
const STATE_SEED = Buffer.from("state");
const PASS_SEED = Buffer.from("pass");
const PASS_META_SEED = Buffer.from("pass_meta");
const FREEZE_SEED = Buffer.from("freeze");

/** Stand unbonding — short so claim can run without 14d wait. */
export const STAND_UNBONDING_SECS = 2;

export type LiveVerifierFlowResult = {
  /** Derived from stake.active after Join. */
  joined: boolean;
  /** Derived from passport status+verifier after Verify. */
  verified: boolean;
  /** Derived from stake.active after Leave. */
  left: boolean;
  /** Derived from Core asset not live + stake inactive after ClosePass. */
  passClosed: boolean;
  /** Derived from claim amount settlement + cleared stake record. */
  claimed: boolean;
  /** Principal claimed (from stake record before claim). */
  claimedAmount: bigint;
  minStakePin: ReturnType<typeof testnetMinStakePinRecord>;
  joinCu: number | null;
  verifyCu: number | null;
  artifacts: StandArtifactBindings;
};

function loadKeypair(p: string): StandKeypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function programIdFromDeploy(name: string): StandPublicKey {
  return loadKeypair(path.join(DEPLOY, `${name}-keypair.json`)).publicKey;
}

function pda(seeds: Buffer[], programId: StandPublicKey): [StandPublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function encodeString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + b.length);
  out.writeUInt32LE(b.length, 0);
  b.copy(out, 4);
  return out;
}

function encodeU64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
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

async function sendIx(
  connection: StandConnection,
  payer: StandKeypair,
  ixs: StandTransactionInstruction[],
  label: string,
): Promise<{ cu: number | null; signature: string }> {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  const parsed = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const cu =
    parsed?.meta?.computeUnitsConsumed != null
      ? Number(parsed.meta.computeUnitsConsumed)
      : null;
  if (parsed?.meta?.err) {
    throw new Error(`${label} failed: ${JSON.stringify(parsed.meta.err)}`);
  }
  console.warn(`[svm-stand verifier] ${label} ok cu=${cu ?? "?"}`);
  return { cu, signature: sig };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Assumes validator already has programs; inits staking+pass+passport if needed,
 * or uses existing configs when `opts.reusePassport` and configs exist.
 */
export async function runLiveVerifierFlow(opts?: {
  /** When true, skip program inits if passport config already exists (after bridge RT). */
  reuseInited?: boolean;
}): Promise<LiveVerifierFlowResult> {
  for (const name of [
    "kar_passport",
    "kar_pro_staking",
    "kar_pro_pass",
    "mock_endpoint",
  ] as const) {
    if (!fs.existsSync(path.join(DEPLOY, `${name}.so`))) {
      throw new Error(`missing ${name}.so — build stand programs first`);
    }
  }

  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair(
    process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
  );
  const bal = await connection.getBalance(payer.publicKey);
  if (bal < 3e9) {
    const sig = await connection.requestAirdrop(payer.publicKey, 5 * 1e9);
    await connection.confirmTransaction(sig, "confirmed");
  }

  const passportProgram = programIdFromDeploy("kar_passport");
  const stakingProgram = programIdFromDeploy("kar_pro_staking");
  const passProgram = programIdFromDeploy("kar_pro_pass");
  const endpointProgram = programIdFromDeploy("mock_endpoint");

  const [passportConfig] = pda([CONFIG_SEED], passportProgram);
  const [stakingConfig] = pda([CONFIG_SEED], stakingProgram);
  const [passConfig] = pda([CONFIG_SEED], passProgram);
  const [passFreeze] = pda([FREEZE_SEED], passProgram);
  const [endpointConfig] = pda([Buffer.from("ep_config")], endpointProgram);

  const minLamports = testnetMinStakeLamports();
  const floorLamports = testnetMinStakeFloorLamports();
  const pin = testnetMinStakePinRecord();

  const passportInfo = await connection.getAccountInfo(passportConfig);

  // Always ensure staking+pass pair exists (bridge RT may have inited passport with mock only).
  if (!(await connection.getAccountInfo(endpointConfig))) {
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
          data: Buffer.from([0]),
        }),
      ],
      "endpoint.Initialize",
    );
  }

  if (!(await connection.getAccountInfo(passConfig))) {
    await sendIx(
      connection,
      payer,
      [
        new TransactionInstruction({
          programId: passProgram,
          keys: [
            { pubkey: passConfig, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([
            Buffer.from([0]),
            Buffer.from(stakingProgram.toBytes()),
          ]),
        }),
      ],
      "pass.Initialize",
    );
  }

  if (!(await connection.getAccountInfo(stakingConfig))) {
    await sendIx(
      connection,
      payer,
      [
        new TransactionInstruction({
          programId: stakingProgram,
          keys: [
            { pubkey: stakingConfig, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([
            Buffer.from([0]),
            Buffer.from(passProgram.toBytes()),
            encodeU64(minLamports),
            encodeU64(floorLamports),
            encodeU64(BigInt(STAND_UNBONDING_SECS)),
          ]),
        }),
      ],
      "staking.Initialize",
    );
  }

  if (!passportInfo) {
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
          data: Buffer.concat([
            Buffer.from([0]),
            encodeU128Le(STAND_SVM_NAMESPACE),
            (() => {
              const b = Buffer.alloc(4);
              b.writeUInt32LE(STAND_SVM_EID, 0);
              return b;
            })(),
            Buffer.from(endpointProgram.toBytes()),
            encodeU64(1_000_000n),
            Buffer.from(stakingProgram.toBytes()),
            Buffer.from(payer.publicKey.toBytes()),
          ]),
        }),
      ],
      "passport.Initialize",
    );
  } else {
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
          data: Buffer.concat([
            Buffer.from([10]),
            Buffer.from(stakingProgram.toBytes()),
          ]),
        }),
      ],
      "passport.SetStakingProgram",
    );
  }

  // Mint a passport for a distinct owner (verifier will not be owner)
  const owner = Keypair.generate();
  {
    const sig = await connection.requestAirdrop(owner.publicKey, 1e9);
    await connection.confirmTransaction(sig, "confirmed");
  }

  // Read next_token_id from config — simplified: mint once and parse from logs is hard;
  // MintPassport advances next_token_id; we derive asset after mint via getProgramAccounts
  // or read config. For stand: mint then scan state PDAs… simpler: authority mint to owner.
  // We need freeze authority for passport mint = gateway freeze. If gateway not inited,
  // mint may fail. For verifier-only path without gateway, passport mint needs freeze PDA
  // from gateway program.

  const gatewayProgram = programIdFromDeploy("kar_gateway");
  const [gatewayConfig] = pda([CONFIG_SEED], gatewayProgram);
  const [gatewayFreeze] = pda([FREEZE_SEED], gatewayProgram);

  if (!(await connection.getAccountInfo(gatewayConfig))) {
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
          data: Buffer.concat([
            Buffer.from([0]),
            (() => {
              const b = Buffer.alloc(4);
              b.writeUInt32LE(STAND_SVM_EID, 0);
              return b;
            })(),
            Buffer.from(endpointProgram.toBytes()),
            Buffer.from(passportProgram.toBytes()),
            encodeU128Le(STAND_SVM_NAMESPACE),
          ]),
        }),
      ],
      "gateway.Initialize",
    );
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
          data: Buffer.concat([
            Buffer.from([1]),
            Buffer.from(gatewayConfig.toBytes()),
          ]),
        }),
      ],
      "passport.SetBridgeGateway",
    );
  }

  // Resolve token id (seq 1, or config next if seq 1 already live from bridge RT).
  let tokenIdBuf = Buffer.from(tokenIdFromParts(STAND_SVM_NAMESPACE, 1n));
  {
    const [probe] = pda([ASSET_SEED, tokenIdBuf], passportProgram);
    const info = await connection.getAccountInfo(probe);
    if (info && info.data.length > 1) {
      const cfgData = (await connection.getAccountInfo(passportConfig))!.data;
      const off = 8 + 32 + 16 + 4 + 32 + 8 + 32 + 32 + 32;
      tokenIdBuf = Buffer.from(cfgData.subarray(off, off + 32));
    }
  }
  const [asset] = pda([ASSET_SEED, tokenIdBuf], passportProgram);
  const [state] = pda([STATE_SEED, tokenIdBuf], passportProgram);

  {
    const info = await connection.getAccountInfo(asset);
    if (!info || info.data.length <= 1) {
      await sendIx(
        connection,
        payer,
        [
          new TransactionInstruction({
            programId: passportProgram,
            keys: [
              { pubkey: passportConfig, isSigner: false, isWritable: true },
              { pubkey: payer.publicKey, isSigner: true, isWritable: false },
              { pubkey: asset, isSigner: false, isWritable: true },
              { pubkey: state, isSigner: false, isWritable: true },
              { pubkey: payer.publicKey, isSigner: true, isWritable: true },
              { pubkey: owner.publicKey, isSigner: false, isWritable: false },
              { pubkey: gatewayFreeze, isSigner: false, isWritable: false },
              { pubkey: CORE_ID, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: Buffer.concat([Buffer.from([2]), encodeString("ar://s5-verifier-stand")]),
          }),
        ],
        "passport.MintPassport",
      );
    }
  }

  // Join as verifier (payer)
  const [stakePda] = pda([STAKE_SEED, Buffer.from(payer.publicKey.toBytes())], stakingProgram);
  const [passAsset] = pda([PASS_SEED, Buffer.from(payer.publicKey.toBytes())], passProgram);
  const [passMeta] = pda([PASS_META_SEED, Buffer.from(payer.publicKey.toBytes())], passProgram);

  const joinResult = await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: stakingProgram,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: passProgram, isSigner: false, isWritable: false },
          { pubkey: passConfig, isSigner: false, isWritable: true },
          { pubkey: passAsset, isSigner: false, isWritable: true },
          { pubkey: passMeta, isSigner: false, isWritable: true },
          { pubkey: passFreeze, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          Buffer.from([1]), // Join
          encodeU64(minLamports),
          Buffer.from([0]), // category MECHANIC
          encodeString("Stand Verifier"),
          encodeString("ar://s5-pro-pass"),
        ]),
      }),
    ],
    "staking.Join",
  );

  const stakeAfterJoin = await connection.getAccountInfo(stakePda);
  if (!stakeAfterJoin) throw new Error("stake PDA missing after Join");
  const joined = assertStakeActive(
    Buffer.from(stakeAfterJoin.data),
    true,
    "post-Join",
  ).active;

  const verifyResult = await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: passportProgram,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: false },
          { pubkey: state, isSigner: false, isWritable: true },
          { pubkey: stakePda, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([11]), tokenIdBuf]), // VerifyPassport
      }),
    ],
    "passport.VerifyPassport",
  );

  const stInfo = await connection.getAccountInfo(state);
  if (!stInfo) throw new Error("passport state missing after Verify");
  assertPassportVerified(
    Buffer.from(stInfo.data),
    Buffer.from(payer.publicKey.toBytes()),
    "post-Verify",
  );
  const verified = Buffer.from(stInfo.data)[8 + 32] === 1;

  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: stakingProgram,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([2]), // Leave
      }),
    ],
    "staking.Leave",
  );

  const stakeAfterLeave = await connection.getAccountInfo(stakePda);
  if (!stakeAfterLeave) throw new Error("stake PDA missing after Leave");
  const left = !assertStakeActive(
    Buffer.from(stakeAfterLeave.data),
    false,
    "post-Leave",
  ).active;

  await sendIx(
    connection,
    payer,
    [
      new TransactionInstruction({
        programId: stakingProgram,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: passProgram, isSigner: false, isWritable: false },
          { pubkey: passConfig, isSigner: false, isWritable: false },
          { pubkey: passAsset, isSigner: false, isWritable: true },
          { pubkey: passMeta, isSigner: false, isWritable: true },
          { pubkey: passFreeze, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([6]), // ClosePass
      }),
    ],
    "staking.ClosePass",
  );

  const passInfoAfterClose = await connection.getAccountInfo(passAsset);
  const stakeAfterClose = await connection.getAccountInfo(stakePda);
  if (!stakeAfterClose) throw new Error("stake PDA missing after ClosePass");
  const passAccount = passInfoAfterClose
    ? {
        owner: passInfoAfterClose.owner,
        data: Buffer.from(passInfoAfterClose.data),
      }
    : null;
  assertPassClosed(passAccount, Buffer.from(stakeAfterClose.data), "post-ClosePass");
  const passClosed = !isLiveCoreAsset(passAccount);

  const claimIx = new TransactionInstruction({
    programId: stakingProgram,
    keys: [
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakePda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    ],
    data: Buffer.from([3]), // ClaimStake
  });

  try {
    await sendIx(connection, payer, [claimIx], "staking.ClaimStake-early");
    throw new Error("early ClaimStake: expected UnbondNotReady, tx succeeded");
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("expected UnbondNotReady, tx succeeded")
    ) {
      throw err;
    }
    assertUnbondNotReady(err, "stand early ClaimStake");
  }

  await sleep((STAND_UNBONDING_SECS + 1) * 1000);

  const rentExemptMin = await connection.getMinimumBalanceForRentExemption(
    STAKE_ACCOUNT_SPACE,
  );
  const stakeBefore = await connection.getAccountInfo(stakePda);
  if (!stakeBefore) throw new Error("stake PDA missing before ClaimStake");
  const decodedBefore = assertStakeActive(
    Buffer.from(stakeBefore.data),
    false,
    "pre-Claim",
  );
  const verifierLamportsBefore = await connection.getBalance(payer.publicKey);

  const claimResult = await sendIx(
    connection,
    payer,
    [claimIx],
    "staking.ClaimStake",
  );

  const claimParsed = await connection.getTransaction(claimResult.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const txFeeLamports = Number(claimParsed?.meta?.fee ?? 0);

  const stakeAfter = await connection.getAccountInfo(stakePda);
  if (!stakeAfter) throw new Error("stake PDA missing after ClaimStake");
  const verifierLamportsAfter = await connection.getBalance(payer.publicKey);

  assertClaimSettled(
    {
      amountFromStake: decodedBefore.amount,
      stakeLamportsBefore: stakeBefore.lamports,
      stakeLamportsAfter: stakeAfter.lamports,
      verifierLamportsBefore,
      verifierLamportsAfter,
      txFeeLamports,
      rentExemptMin,
    },
    "post-ClaimStake",
  );
  const cleared = assertStakeClearedAfterClaim(
    Buffer.from(stakeAfter.data),
    "post-ClaimStake",
  );
  const claimed = decodedBefore.amount > 0n && cleared.amount === 0n;

  return withStandArtifactBindings({
    joined,
    verified,
    left,
    passClosed,
    claimed,
    claimedAmount: decodedBefore.amount,
    minStakePin: pin,
    joinCu: joinResult.cu,
    verifyCu: verifyResult.cu,
  });
}
