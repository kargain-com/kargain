/**
 * S4b X3 — init passport + gateway on Devnet after upgradeable deploy.
 * Env (set by deploy-devnet.sh):
 *   SVM_X3_PASSPORT_PROGRAM, SVM_X3_GATEWAY_PROGRAM, SVM_X3_STAKING_PROGRAM
 *   SVM_X3_DEPLOYER_KEYPAIR, SOLANA_RPC_URL, SOLANA_LZ_ENDPOINT, SOLANA_FORFEIT_RECIPIENT
 * Never logs key material.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

function loadWeb3(): typeof import("@solana/web3.js") {
  try {
    return require("@solana/web3.js");
  } catch {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const root = join(process.cwd(), "node_modules/.pnpm");
    const hit = readdirSync(root).find((d) => d.startsWith("@solana+web3.js@"));
    if (!hit) throw new Error("@solana/web3.js not found");
    return require(join(root, hit, "node_modules/@solana/web3.js"));
  }
}

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = loadWeb3();

const EID = 40168;
const NAMESPACE = 2_000_040_168n;
const DISPUTE_DEPOSIT = 1_000_000n;

function encodeU128Le(n: bigint): Buffer {
  const b = Buffer.alloc(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function passportInitializeData(args: {
  namespace: bigint;
  localEid: number;
  endpoint: InstanceType<typeof PublicKey>;
  disputeDeposit: bigint;
  staking: InstanceType<typeof PublicKey>;
  forfeit: InstanceType<typeof PublicKey>;
}): Buffer {
  const eid = Buffer.alloc(4);
  eid.writeUInt32LE(args.localEid, 0);
  const dep = Buffer.alloc(8);
  dep.writeBigUInt64LE(args.disputeDeposit, 0);
  return Buffer.concat([
    Buffer.from([0]),
    encodeU128Le(args.namespace),
    eid,
    Buffer.from(args.endpoint.toBytes()),
    dep,
    Buffer.from(args.staking.toBytes()),
    Buffer.from(args.forfeit.toBytes()),
  ]);
}

function gatewayInitializeData(args: {
  localEid: number;
  endpoint: InstanceType<typeof PublicKey>;
  passport: InstanceType<typeof PublicKey>;
  namespace: bigint;
}): Buffer {
  const eid = Buffer.alloc(4);
  eid.writeUInt32LE(args.localEid, 0);
  return Buffer.concat([
    Buffer.from([0]),
    eid,
    Buffer.from(args.endpoint.toBytes()),
    Buffer.from(args.passport.toBytes()),
    encodeU128Le(args.namespace),
  ]);
}

function passportSetGatewayData(gateway: InstanceType<typeof PublicKey>): Buffer {
  return Buffer.concat([Buffer.from([1]), Buffer.from(gateway.toBytes())]);
}

function pda(seeds: (Buffer | Uint8Array)[], programId: InstanceType<typeof PublicKey>) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

async function main(): Promise<void> {
  const rpc = requireEnv("SOLANA_RPC_URL");
  const passportId = new PublicKey(requireEnv("SVM_X3_PASSPORT_PROGRAM"));
  const gatewayId = new PublicKey(requireEnv("SVM_X3_GATEWAY_PROGRAM"));
  const stakingId = new PublicKey(requireEnv("SVM_X3_STAKING_PROGRAM"));
  const endpointId = new PublicKey(requireEnv("SOLANA_LZ_ENDPOINT"));
  const forfeit = new PublicKey(requireEnv("SOLANA_FORFEIT_RECIPIENT"));
  const kpPath = requireEnv("SVM_X3_DEPLOYER_KEYPAIR");
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")) as number[]);
  const payer = Keypair.fromSecretKey(secret);

  const connection = new Connection(rpc, "confirmed");
  const passportConfig = pda([Buffer.from("config")], passportId);
  const gatewayConfig = pda([Buffer.from("config")], gatewayId);

  const send = async (label: string, ix: InstanceType<typeof TransactionInstruction>) => {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });
    console.log(`  ${label} ok sig=${sig.slice(0, 12)}…`);
  };

  console.log("  init passport config…");
  await send(
    "passport.Initialize",
    new TransactionInstruction({
      programId: passportId,
      keys: [
        { pubkey: passportConfig, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: passportInitializeData({
        namespace: NAMESPACE,
        localEid: EID,
        endpoint: endpointId,
        disputeDeposit: DISPUTE_DEPOSIT,
        staking: stakingId,
        forfeit,
      }),
    }),
  );

  console.log("  init gateway config…");
  await send(
    "gateway.Initialize",
    new TransactionInstruction({
      programId: gatewayId,
      keys: [
        { pubkey: gatewayConfig, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: gatewayInitializeData({
        localEid: EID,
        endpoint: endpointId,
        passport: passportId,
        namespace: NAMESPACE,
      }),
    }),
  );

  console.log("  setBridgeGateway…");
  await send(
    "passport.SetBridgeGateway",
    new TransactionInstruction({
      programId: passportId,
      keys: [
        { pubkey: passportConfig, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data: passportSetGatewayData(gatewayId),
    }),
  );

  console.log("  init complete");
  console.log(`  passportConfig=${passportConfig.toBase58()}`);
  console.log(`  gatewayConfig=${gatewayConfig.toBase58()}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
