/**
 * One-shot Devnet InitConfig for FixedPrice + Ascending (founder ops helper).
 * Not a product door — run then shred. Uses encodeSvmInstruction + deriveSvmPda.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { requireSvmCommercialActive } from "../lib/web3/commercial-active.ts";
import { encodeSvmInstruction } from "../lib/svm/encode-instruction.ts";
import { deriveSvmPda } from "../lib/svm/derive-pda.ts";
import { systemProgramId } from "../lib/svm/foreign-programs.ts";
import { programIdToBytes } from "./svm-devnet-bind-modes.ts";
import {
  ASCENDING_CHALLENGE_WINDOW,
  MARKETPLACE_FEE_BPS,
} from "./lib/verify-constructor-args.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../svm/lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
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
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")) as number[]),
  );
}

async function main(): Promise<void> {
  const rpc = arg("--rpc");
  const authority = loadKp(arg("--authority-keypair"));
  const payer = authority;
  const stack = requireSvmCommercialActive(2_000_040_168);
  const fp = stack.fixedPriceConsignment!;
  const asc = stack.ascendingConsignment!;
  const conn = new Connection(rpc, "confirmed");

  const feeBps = Number(MARKETPLACE_FEE_BPS);
  // Same lamports as on-chain passport dispute_deposit (weight class, not ETH wei).
  const challengeBond = 1_000_000n;
  const challengeWindow = ASCENDING_CHALLENGE_WINDOW;
  const platform = new PublicKey(stack.forfeitRecipient);
  const guardian = authority.publicKey;
  const forfeit = new PublicKey(stack.forfeitRecipient);
  const staking = programIdToBytes(stack.karProStaking);
  const system = new PublicKey(systemProgramId());

  const [fpCfg, ascCfg] = await Promise.all([
    deriveSvmPda({ recipe: "kargain-consignment-base/config", programId: fp }),
    deriveSvmPda({ recipe: "kargain-consignment-base/config", programId: asc }),
  ]);
  if (!fpCfg.ok || !ascCfg.ok) {
    throw new Error(`pda_failed`);
  }

  async function maybeInit(
    label: string,
    programId: string,
    configAddr: string,
    data: Uint8Array,
    keys: {
      pubkey: InstanceType<typeof PublicKey>;
      isSigner: boolean;
      isWritable: boolean;
    }[],
  ): Promise<void> {
    const existing = await conn.getAccountInfo(new PublicKey(configAddr));
    if (existing != null && existing.data.length > 0) {
      console.log(`${label} already_initialized ${configAddr} len=${existing.data.length}`);
      return;
    }
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        new TransactionInstruction({
          programId: new PublicKey(programId),
          keys,
          data: Buffer.from(data),
        }),
      ),
      [payer, authority],
      { commitment: "confirmed" },
    );
    console.log(`${label} InitConfig ok ${sig}`);
  }

  const fpEnc = encodeSvmInstruction({
    program: "kar-fixed-price",
    variant: "InitConfig",
    fields: { platform_fee_bps: feeBps },
  });
  if (!fpEnc.ok) throw new Error(fpEnc.detail);
  await maybeInit("fixed_price", fp, fpCfg.address, fpEnc.data, [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(fpCfg.address), isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    { pubkey: platform, isSigner: false, isWritable: false },
    { pubkey: guardian, isSigner: false, isWritable: false },
    { pubkey: system, isSigner: false, isWritable: false },
  ]);

  const ascEnc = encodeSvmInstruction({
    program: "kar-ascending",
    variant: "InitConfig",
    fields: {
      platform_fee_bps: feeBps,
      challenge_bond: challengeBond,
      challenge_window: challengeWindow,
      staking_program: staking,
    },
  });
  if (!ascEnc.ok) throw new Error(ascEnc.detail);
  await maybeInit("ascending", asc, ascCfg.address, ascEnc.data, [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(ascCfg.address), isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    { pubkey: platform, isSigner: false, isWritable: false },
    { pubkey: guardian, isSigner: false, isWritable: false },
    { pubkey: forfeit, isSigner: false, isWritable: false },
    { pubkey: system, isSigner: false, isWritable: false },
  ]);

  console.log(`fee_bps ${feeBps}`);
  console.log(`challenge_bond ${challengeBond}`);
  console.log(`challenge_window ${challengeWindow}`);
  console.log(`platform ${platform.toBase58()}`);
  console.log(`guardian ${guardian.toBase58()}`);
  console.log(`forfeit ${forfeit.toBase58()}`);
  console.log(`staking ${stack.karProStaking}`);
  console.log(`fixed_price_config ${fpCfg.address}`);
  console.log(`ascending_config ${ascCfg.address}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
