/**
 * U9.0 — minimal Devnet MintPassport ops door.
 *
 * Sends exactly one instruction: PassportIx::MintPassport (ix.manifest index 2).
 * No config write, no evidence write, no stake, no verify.
 *
 * Instruction data + PDAs come from product owners (encodeSvmInstruction /
 * deriveSvmPda). Config `next_token_id` is an ops hand-read at offset 196 —
 * product PassportConfig decode stays partial (no accountSpace debt).
 *
 * Transport is stand web3.js (same class as s5/y5). Product sendSvmInstruction
 * + Wallet Standard port is U9.1.
 *
 *   pnpm svm:mint-passport -- \
 *     --rpc <url> \
 *     --authority-keypair <path> \
 *     --owner <base58> \
 *     --uri <ar://...> \
 *     [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { requireSvmCommercialActive } from "../lib/web3/commercial-active.ts";
import { encodeSvmInstruction } from "../lib/svm/encode-instruction.ts";
import { deriveSvmPda } from "../lib/svm/derive-pda.ts";
import { tokenIdFromBytes32 } from "../lib/svm/event-payload-decode.ts";
import {
  mplCoreProgramId,
  systemProgramId,
} from "../lib/svm/foreign-programs.ts";

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

/** Solana Devnet commercial namespace — sole runtime stack for this door. */
const SVM_DEVNET_NAMESPACE = 2_000_040_168;

/**
 * PassportIx::MintPassport ordinal in svm/crates/kargain-ix-wire/ix.manifest.json
 * (kar-passport enum index 2). Product encode owns the wire byte; this name is
 * for refusal/docs only — never a bare tag-2 Buffer literal at the call site.
 */
export const MINT_PASSPORT_VARIANT = "MintPassport" as const;

const PASSPORT_CONFIG_DISCRIMINATOR = Buffer.from("kp_cfg\0\0", "utf8");
/** After disc(8)+authority(32)+namespace(16)+eid(4)+endpoint(32)+deposit(8)+staking(32)+gateway(32)+forfeit(32). */
export const NEXT_TOKEN_ID_OFFSET = 196;
const MIN_CONFIG_LEN_FOR_NEXT_TOKEN_ID = 228;

export type MintPassportRefusalCause =
  | "invalid_owner"
  | "config_not_found"
  | "config_discriminator_mismatch"
  | "config_too_short"
  | "authority_mismatch"
  | "token_exists";

export const MINT_PASSPORT_REFUSAL_CAUSES: readonly MintPassportRefusalCause[] = [
  "invalid_owner",
  "config_not_found",
  "config_discriminator_mismatch",
  "config_too_short",
  "authority_mismatch",
  "token_exists",
] as const;

class MintPassportRefusal extends Error {
  readonly causeName: MintPassportRefusalCause;
  constructor(cause: MintPassportRefusalCause, detail: string) {
    super(`${cause}: ${detail}`);
    this.name = "MintPassportRefusal";
    this.causeName = cause;
  }
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function loadKp(p: string): InstanceType<typeof Keypair> {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function parseOwnerPubkey(base58: string): InstanceType<typeof PublicKey> {
  try {
    return new PublicKey(base58);
  } catch {
    throw new MintPassportRefusal(
      "invalid_owner",
      `--owner is not a valid base58 pubkey`,
    );
  }
}

function isLiveCoreAsset(info: {
  owner: InstanceType<typeof PublicKey>;
  data: Buffer;
} | null): boolean {
  if (info == null) return false;
  const core = new PublicKey(mplCoreProgramId());
  return info.owner.equals(core) && info.data.length > 1;
}

async function main(): Promise<void> {
  const rpc = arg("--rpc");
  const authority = loadKp(arg("--authority-keypair"));
  const owner = parseOwnerPubkey(arg("--owner"));
  const uri = arg("--uri");
  const dryRun = hasFlag("--dry-run");

  const stack = requireSvmCommercialActive(SVM_DEVNET_NAMESPACE);
  const passportProgramId = stack.karPassport;
  const gatewayProgramId = stack.bridgeGateway;

  const encoded = encodeSvmInstruction({
    program: "kar-passport",
    variant: MINT_PASSPORT_VARIANT,
    fields: { uri },
  });
  if (!encoded.ok) {
    throw new Error(`encode_failed: ${encoded.cause}:${encoded.detail}`);
  }

  const [configPda, freezePda] = await Promise.all([
    deriveSvmPda({
      recipe: "kar-passport/config",
      programId: passportProgramId,
    }),
    deriveSvmPda({
      recipe: "kar-gateway/freeze",
      programId: gatewayProgramId,
    }),
  ]);
  if (!configPda.ok) {
    throw new Error(`pda_failed:config:${configPda.cause}:${configPda.detail}`);
  }
  if (!freezePda.ok) {
    throw new Error(`pda_failed:freeze:${freezePda.cause}:${freezePda.detail}`);
  }

  const connection = new Connection(rpc, "confirmed");
  const configKey = new PublicKey(configPda.address);
  const configInfo = await connection.getAccountInfo(configKey);
  if (configInfo == null) {
    throw new MintPassportRefusal(
      "config_not_found",
      `no account at ${configPda.address}`,
    );
  }
  const cfgData = Buffer.from(configInfo.data);
  if (
    cfgData.length < 8 ||
    !bytesEqual(cfgData.subarray(0, 8), PASSPORT_CONFIG_DISCRIMINATOR)
  ) {
    throw new MintPassportRefusal(
      "config_discriminator_mismatch",
      `first 8 bytes are not kp_cfg\\0\\0`,
    );
  }
  if (cfgData.length < MIN_CONFIG_LEN_FOR_NEXT_TOKEN_ID) {
    throw new MintPassportRefusal(
      "config_too_short",
      `len ${cfgData.length} < ${MIN_CONFIG_LEN_FOR_NEXT_TOKEN_ID}`,
    );
  }

  const authorityOnChain = cfgData.subarray(8, 40);
  const authorityLocal = authority.publicKey.toBytes();
  if (!bytesEqual(authorityOnChain, authorityLocal)) {
    throw new MintPassportRefusal(
      "authority_mismatch",
      `config authority does not match --authority-keypair pubkey`,
    );
  }

  const tokenIdBytes = Uint8Array.from(
    cfgData.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
  );
  const tokenIdDecimal = tokenIdFromBytes32(tokenIdBytes);

  const [assetPda, statePda] = await Promise.all([
    deriveSvmPda({
      recipe: "kar-passport/asset",
      programId: passportProgramId,
      seeds: { token_id: tokenIdBytes },
    }),
    deriveSvmPda({
      recipe: "kar-passport/state",
      programId: passportProgramId,
      seeds: { token_id: tokenIdBytes },
    }),
  ]);
  if (!assetPda.ok) {
    throw new Error(`pda_failed:asset:${assetPda.cause}:${assetPda.detail}`);
  }
  if (!statePda.ok) {
    throw new Error(`pda_failed:state:${statePda.cause}:${statePda.detail}`);
  }

  const assetKey = new PublicKey(assetPda.address);
  const assetInfo = await connection.getAccountInfo(assetKey);
  if (isLiveCoreAsset(assetInfo)) {
    throw new MintPassportRefusal(
      "token_exists",
      `live Core asset already at ${assetPda.address}`,
    );
  }

  const ixData = Buffer.from(encoded.data);
  const coreId = new PublicKey(mplCoreProgramId());
  const systemId = new PublicKey(systemProgramId());

  // Exactly one instruction — mint_passport account order (entrypoint).
  const instruction = new TransactionInstruction({
    programId: new PublicKey(passportProgramId),
    keys: [
      { pubkey: configKey, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: assetKey, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(statePda.address), isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(freezePda.address), isSigner: false, isWritable: false },
      { pubkey: coreId, isSigner: false, isWritable: false },
      { pubkey: systemId, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  console.log(`program_id ${passportProgramId}`);
  console.log(`config ${configPda.address}`);
  console.log(`token_id_hex ${toHex(tokenIdBytes)}`);
  console.log(`token_id ${tokenIdDecimal}`);
  console.log(`asset ${assetPda.address}`);
  console.log(`state ${statePda.address}`);
  console.log(`freeze_authority ${freezePda.address}`);
  console.log(`owner ${owner.toBase58()}`);
  console.log(`instruction_data_hex ${toHex(encoded.data)}`);

  if (dryRun) {
    console.log("dry_run ok — not sent");
    return;
  }

  const tx = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [authority],
    { commitment: "confirmed" },
  );
  console.log(`token_id ${tokenIdDecimal}`);
  console.log(`signature ${signature}`);
  console.log(
    `explorer https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  );
}

const invokedAsCli =
  process.argv[1] != null &&
  /svm-devnet-mint-passport\.(ts|js)$/.test(path.resolve(process.argv[1]));

if (invokedAsCli) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
