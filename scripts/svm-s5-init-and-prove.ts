/**
 * S5 Devnet: pair-init staking+pass, SetStakingProgram on live passport,
 * prove join→verify→leave→claim, write evidence. Retains deployer UA (no handoff).
 *
 * Usage (from deploy-s5-staking.sh):
 *   pnpm exec tsx scripts/svm-s5-init-and-prove.ts \
 *     --staking <id> --pass <id> --deployer-keypair <path> --rpc <url> \
 *     --evidence deployments/svm-40168.json --work <tmpdir>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  testnetMinStakeFloorLamports,
  testnetMinStakeLamports,
  testnetMinStakePinRecord,
} from "../lib/web3/min-stake-sol.ts";
import { loadSvmDevnetEvidence, type SvmDevnetEvidence } from "./lib/load-deployment.ts";
import { assertSolanaUpgradeAuthorityMatchesDeployer } from "./lib/svm-deploy-plan.ts";
import {
  STAKE_ACCOUNT_SPACE,
  assertClaimSettled,
  assertPassClosed,
  assertPassportVerified,
  assertStakeActive,
  assertStakeClearedAfterClaim,
  assertUnbondNotReady,
} from "./lib/svm-verifier-lifecycle-asserts.ts";
import { writeSvmDevnetEvidence } from "./lib/write-deployment.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../svm/lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return process.argv[i + 1]!;
}


function loadKp(p: string): InstanceType<typeof Keypair> {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function pda(seeds: Buffer[], programId: InstanceType<typeof PublicKey>) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function encodeU64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

function encodeString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + b.length);
  out.writeUInt32LE(b.length, 0);
  b.copy(out, 4);
  return out;
}

async function main() {
  const stakingId = new PublicKey(arg("--staking"));
  const passId = new PublicKey(arg("--pass"));
  const deployer = loadKp(arg("--deployer-keypair"));
  const rpc = arg("--rpc");
  const evidencePath = arg("--evidence");
  const deployerPub = deployer.publicKey.toBase58();
  assertSolanaUpgradeAuthorityMatchesDeployer(deployerPub);

  const connection = new Connection(rpc, "confirmed");
  const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
  const CONFIG = Buffer.from("config");
  const STAKE = Buffer.from("stake");
  const PASS = Buffer.from("pass");
  const PASS_META = Buffer.from("pass_meta");
  const FREEZE = Buffer.from("freeze");
  const ASSET = Buffer.from("asset");
  const STATE = Buffer.from("state");

  const [stakingConfig] = pda([CONFIG], stakingId);
  const [passConfig] = pda([CONFIG], passId);
  const [passFreeze] = pda([FREEZE], passId);

  const minLamports = testnetMinStakeLamports();
  const floorLamports = testnetMinStakeFloorLamports();
  /** Devnet proof uses short unbond (same as stand). */
  const unbondSecs = 2n;

  const send = async (
    ixs: InstanceType<typeof TransactionInstruction>[],
    label: string,
  ) => {
    const tx = new Transaction().add(...ixs);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
      commitment: "confirmed",
    });
    console.log(`  ${label} ${sig.slice(0, 12)}…`);
  };

  // Pair init
  if (!(await connection.getAccountInfo(passConfig))) {
    await send(
      [
        new TransactionInstruction({
          programId: passId,
          keys: [
            { pubkey: passConfig, isSigner: false, isWritable: true },
            { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([Buffer.from([0]), Buffer.from(stakingId.toBytes())]),
        }),
      ],
      "pass.Initialize",
    );
  }

  if (!(await connection.getAccountInfo(stakingConfig))) {
    await send(
      [
        new TransactionInstruction({
          programId: stakingId,
          keys: [
            { pubkey: stakingConfig, isSigner: false, isWritable: true },
            { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([
            Buffer.from([0]),
            Buffer.from(passId.toBytes()),
            encodeU64(minLamports),
            encodeU64(floorLamports),
            encodeU64(unbondSecs),
          ]),
        }),
      ],
      "staking.Initialize",
    );
  }

  const prior = loadSvmDevnetEvidence(40168);
  if (!prior?.programs?.kar_passport?.programId) {
    throw new Error(
      "Missing prior svm-40168 evidence with kar_passport — upgrade passport BPF then SetStakingProgram",
    );
  }
  const passportId = new PublicKey(prior.programs.kar_passport.programId);
  const [passportConfig] = pda([CONFIG], passportId);

  // SetStakingProgram (requires passport BPF with disc 10)
  await send(
    [
      new TransactionInstruction({
        programId: passportId,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([10]), Buffer.from(stakingId.toBytes())]),
      }),
    ],
    "passport.SetStakingProgram",
  );

  // Mint passport to a distinct owner; deployer joins as verifier (CannotSelfVerify).
  const owner = Keypair.generate();
  const gatewayId = new PublicKey(prior.programs.kar_gateway.programId);
  const [gatewayFreeze] = pda([FREEZE], gatewayId);

  const cfgData = (await connection.getAccountInfo(passportConfig))!.data;
  const off = 8 + 32 + 16 + 4 + 32 + 8 + 32 + 32 + 32;
  const tokenIdBuf = Buffer.from(cfgData.subarray(off, off + 32));
  const [asset] = pda([ASSET, tokenIdBuf], passportId);
  const [state] = pda([STATE, tokenIdBuf], passportId);

  await send(
    [
      new TransactionInstruction({
        programId: passportId,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: state, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
          { pubkey: owner.publicKey, isSigner: false, isWritable: false },
          { pubkey: gatewayFreeze, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([2]), encodeString("ar://s5-devnet-verifier")]),
      }),
    ],
    "passport.MintPassport",
  );

  // Fresh verifier wallet — Core pass PDA is tombstoned after close (D-17); cannot re-join same wallet.
  const verifier = Keypair.generate();
  const fundLamports = minLamports + 50_000_000n; // stake + fees/rent headroom
  {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: verifier.publicKey,
        lamports: Number(fundLamports),
      }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], {
      commitment: "confirmed",
    });
    console.log(`  fund verifier ${verifier.publicKey.toBase58().slice(0, 8)}… ${sig.slice(0, 12)}…`);
  }

  const sendAs = async (
    ixs: InstanceType<typeof TransactionInstruction>[],
    signers: InstanceType<typeof Keypair>[],
    label: string,
  ) => {
    const tx = new Transaction().add(...ixs);
    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
      commitment: "confirmed",
    });
    console.log(`  ${label} ${sig.slice(0, 12)}…`);
  };

  const [stakePda] = pda([STAKE, Buffer.from(verifier.publicKey.toBytes())], stakingId);
  const [passAsset] = pda([PASS, Buffer.from(verifier.publicKey.toBytes())], passId);
  const [passMeta] = pda([PASS_META, Buffer.from(verifier.publicKey.toBytes())], passId);

  await sendAs(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: verifier.publicKey, isSigner: true, isWritable: true },
          { pubkey: passId, isSigner: false, isWritable: false },
          { pubkey: passConfig, isSigner: false, isWritable: true },
          { pubkey: passAsset, isSigner: false, isWritable: true },
          { pubkey: passMeta, isSigner: false, isWritable: true },
          { pubkey: passFreeze, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          Buffer.from([1]),
          encodeU64(minLamports),
          Buffer.from([0]),
          encodeString("Devnet Verifier"),
          encodeString("ar://s5-pro-pass-devnet"),
        ]),
      }),
    ],
    [verifier],
    "staking.Join",
  );

  {
    const stakeInfo = await connection.getAccountInfo(stakePda);
    if (!stakeInfo) throw new Error("stake PDA missing after Join");
    assertStakeActive(Buffer.from(stakeInfo.data), true, "post-Join");
    console.log("  assert post-Join active=true OK");
  }

  await sendAs(
    [
      new TransactionInstruction({
        programId: passportId,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: false },
          { pubkey: state, isSigner: false, isWritable: true },
          { pubkey: stakePda, isSigner: false, isWritable: false },
          { pubkey: verifier.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([11]), tokenIdBuf]),
      }),
    ],
    [verifier],
    "passport.VerifyPassport",
  );

  {
    const stInfo = await connection.getAccountInfo(state);
    if (!stInfo) throw new Error("passport state missing after Verify");
    assertPassportVerified(
      Buffer.from(stInfo.data),
      Buffer.from(verifier.publicKey.toBytes()),
      "post-Verify",
    );
    console.log("  assert post-Verify status=Verified verifier OK");
  }

  await sendAs(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: verifier.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([2]),
      }),
    ],
    [verifier],
    "staking.Leave",
  );

  {
    const stakeInfo = await connection.getAccountInfo(stakePda);
    if (!stakeInfo) throw new Error("stake PDA missing after Leave");
    assertStakeActive(Buffer.from(stakeInfo.data), false, "post-Leave");
    console.log("  assert post-Leave active=false OK");
  }

  await sendAs(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: false },
          { pubkey: verifier.publicKey, isSigner: true, isWritable: true },
          { pubkey: passId, isSigner: false, isWritable: false },
          { pubkey: passConfig, isSigner: false, isWritable: false },
          { pubkey: passAsset, isSigner: false, isWritable: true },
          { pubkey: passMeta, isSigner: false, isWritable: true },
          { pubkey: passFreeze, isSigner: false, isWritable: false },
          { pubkey: verifier.publicKey, isSigner: false, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([6]),
      }),
    ],
    [verifier],
    "staking.ClosePass",
  );

  {
    const passInfo = await connection.getAccountInfo(passAsset);
    const stakeInfo = await connection.getAccountInfo(stakePda);
    if (!stakeInfo) throw new Error("stake PDA missing after ClosePass");
    assertPassClosed(
      passInfo
        ? { owner: passInfo.owner, data: Buffer.from(passInfo.data) }
        : null,
      Buffer.from(stakeInfo.data),
      "post-ClosePass",
    );
    console.log("  assert post-ClosePass pass not live + stake.active=false OK");
  }

  const claimIx = new TransactionInstruction({
    programId: stakingId,
    keys: [
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakePda, isSigner: false, isWritable: true },
      { pubkey: verifier.publicKey, isSigner: true, isWritable: true },
    ],
    data: Buffer.from([3]),
  });

  try {
    await sendAs([claimIx], [verifier], "staking.ClaimStake-early");
    throw new Error("post-Leave early ClaimStake: expected UnbondNotReady, tx succeeded");
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("expected UnbondNotReady, tx succeeded")
    ) {
      throw err;
    }
    assertUnbondNotReady(err, "post-Leave early ClaimStake");
    console.log("  assert early ClaimStake → UnbondNotReady OK");
  }

  await new Promise((r) => setTimeout(r, 3000));

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
  const verifierLamportsBefore = await connection.getBalance(verifier.publicKey);

  const claimTx = new Transaction().add(claimIx);
  const claimSig = await sendAndConfirmTransaction(
    connection,
    claimTx,
    [verifier],
    { commitment: "confirmed" },
  );
  console.log(`  staking.ClaimStake ${claimSig.slice(0, 12)}…`);

  const claimParsed = await connection.getTransaction(claimSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const txFeeLamports = Number(claimParsed?.meta?.fee ?? 0);
  const stakeAfter = await connection.getAccountInfo(stakePda);
  if (!stakeAfter) throw new Error("stake PDA missing after ClaimStake");
  const verifierLamportsAfter = await connection.getBalance(verifier.publicKey);

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
  assertStakeClearedAfterClaim(Buffer.from(stakeAfter.data), "post-ClaimStake");
  console.log(
    `  assert post-ClaimStake amount=${decodedBefore.amount} ` +
      `stakeΔ=${stakeBefore.lamports - stakeAfter.lamports} ` +
      `verifierΔ=${verifierLamportsAfter - verifierLamportsBefore} ` +
      `fee=${txFeeLamports} rentMin=${rentExemptMin} OK`,
  );

  console.log("==> retain deployer upgrade authority (no handoff)");

  const pin = testnetMinStakePinRecord();
  const slotAtWrite = await connection.getSlot("confirmed");
  const evidence: SvmDevnetEvidence = {
    ...prior,
    programs: {
      ...prior.programs,
      kar_passport: {
        ...prior.programs.kar_passport,
        upgradeAuthority: deployerPub,
      },
      kar_pro_staking: {
        programId: stakingId.toBase58(),
        deploySlot: prior.programs.kar_pro_staking?.deploySlot ?? slotAtWrite,
        upgradeAuthority: deployerPub,
      },
      kar_pro_pass: {
        programId: passId.toBase58(),
        deploySlot: prior.programs.kar_pro_pass?.deploySlot ?? slotAtWrite,
        upgradeAuthority: deployerPub,
      },
    },
    minStakePin: pin,
    s5Prove: {
      at: new Date().toISOString(),
      prove:
        "join(active)→verify(status)→leave(inactive)→close(tombstone)→claim-early(UnbondNotReady)→claim(amount+rent)",
      upgradeAuthority: "deployer retained (S4–S9)",
    },
  };
  writeSvmDevnetEvidence(evidencePath, evidence);
  console.log(`==> evidence written ${evidencePath}`);
  console.log("S5 Devnet prove PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
