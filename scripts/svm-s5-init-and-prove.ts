/**
 * S5 Devnet: pair-init staking+pass, SetStakingProgram on live passport,
 * prove join→verify→leave→claim, hand UA to SOLANA_UPGRADE_AUTHORITY, write evidence.
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
  const finalUa = process.env.SOLANA_UPGRADE_AUTHORITY?.trim();
  if (!finalUa) throw new Error("SOLANA_UPGRADE_AUTHORITY required");

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

  // Mint passport to a distinct owner, join as deployer, verify, leave, close, claim
  const owner = Keypair.generate();
  // Fund owner for rent if needed — mint payer is deployer
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

  const [stakePda] = pda([STAKE, Buffer.from(deployer.publicKey.toBytes())], stakingId);
  const [passAsset] = pda([PASS, Buffer.from(deployer.publicKey.toBytes())], passId);
  const [passMeta] = pda([PASS_META, Buffer.from(deployer.publicKey.toBytes())], passId);

  await send(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
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
    "staking.Join",
  );

  await send(
    [
      new TransactionInstruction({
        programId: passportId,
        keys: [
          { pubkey: passportConfig, isSigner: false, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: false },
          { pubkey: state, isSigner: false, isWritable: true },
          { pubkey: stakePda, isSigner: false, isWritable: false },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([11]), tokenIdBuf]),
      }),
    ],
    "passport.VerifyPassport",
  );

  await send(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([2]),
      }),
    ],
    "staking.Leave",
  );

  await send(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: false },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
          { pubkey: passId, isSigner: false, isWritable: false },
          { pubkey: passConfig, isSigner: false, isWritable: false },
          { pubkey: passAsset, isSigner: false, isWritable: true },
          { pubkey: passMeta, isSigner: false, isWritable: true },
          { pubkey: passFreeze, isSigner: false, isWritable: false },
          { pubkey: deployer.publicKey, isSigner: false, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([6]),
      }),
    ],
    "staking.ClosePass",
  );

  await new Promise((r) => setTimeout(r, 3000));

  await send(
    [
      new TransactionInstruction({
        programId: stakingId,
        keys: [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
        ],
        data: Buffer.from([3]),
      }),
    ],
    "staking.ClaimStake",
  );

  console.log("==> hand upgrade authority → SOLANA_UPGRADE_AUTHORITY");
  const { execFileSync } = await import("node:child_process");
  for (const [name, pid] of [
    ["kar_pro_staking", stakingId.toBase58()],
    ["kar_pro_pass", passId.toBase58()],
  ] as const) {
    execFileSync(
      "solana",
      [
        "program",
        "set-upgrade-authority",
        pid,
        "--new-upgrade-authority",
        finalUa,
        "--keypair",
        arg("--deployer-keypair"),
        "-u",
        rpc,
      ],
      { stdio: "inherit" },
    );
    const show = execFileSync("solana", ["program", "show", pid, "-u", rpc], {
      encoding: "utf8",
    });
    if (!show.includes(`Authority: ${finalUa}`)) {
      throw new Error(`FAIL: ${name} UA handoff read-back`);
    }
    console.log(`  ${name} UA → ${finalUa.slice(0, 4)}…`);
  }

  const pin = testnetMinStakePinRecord();
  const evidence: SvmDevnetEvidence = {
    ...prior,
    programs: {
      ...prior.programs,
      kar_pro_staking: {
        programId: stakingId.toBase58(),
        upgradeAuthority: finalUa,
      },
      kar_pro_pass: {
        programId: passId.toBase58(),
        upgradeAuthority: finalUa,
      },
    },
    minStakePin: pin,
  };
  writeSvmDevnetEvidence(evidencePath, evidence);
  console.log(`==> evidence written ${evidencePath}`);
  console.log("S5 Devnet prove PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
