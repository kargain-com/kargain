/**
 * LIVE proof: permissionless MintPassport — fresh payer ≠ config authority,
 * Core PermanentFreeze authority readback, validator refusals.
 *
 * BridgeGatewayUnbound is admit/cargo-only (stand binds gateway at init).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  withStandArtifactBindings,
  type StandArtifactBindings,
} from "./stand-artifact-bindings.ts";
import { expectStandTransactionRefusal } from "./stand-tx-refusal.ts";
import {
  airdrop,
  CORE_ID,
  coreOwner,
  encodeString,
  ensurePassportCommerceStack,
  ix,
  mintPassportAsset,
  NEXT_TOKEN_ID_OFFSET,
  PASSPORT_IX,
  passportStateStatus,
  pda,
  permanentFreezePlugin,
  RPC_DEFAULT,
  SEED,
  type Conn,
  type Kp,
  type Pk,
} from "./stand-passport-commerce.ts";

const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lab/package.json"),
);
const { Connection, Keypair, SystemProgram, Transaction } =
  require("@solana/web3.js") as typeof import("@solana/web3.js");

export type LivePermissionlessMintProof = {
  artifacts: StandArtifactBindings;
  payerEqualsAuthority: false;
  owner: string;
  gatewayFreeze: string;
  freezeAuthority: string;
  frozen: false;
  passportStatus: 0;
  nextTokenIdAdvanced: true;
  refusals: {
    foreignFreeze: "InvalidSeeds";
    ownerIsGateway: "InvalidReceiver";
  };
  note: "BridgeGatewayUnbound is admit/cargo-only; stand binds gateway at init";
};

function mintKeys(args: {
  passportConfig: Pk;
  asset: Pk;
  state: Pk;
  payer: Pk;
  owner: Pk;
  freeze: Pk;
  gatewayConfig: Pk;
}) {
  return [
    { pubkey: args.passportConfig, isSigner: false, isWritable: true },
    { pubkey: args.asset, isSigner: false, isWritable: true },
    { pubkey: args.state, isSigner: false, isWritable: true },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: args.owner, isSigner: false, isWritable: false },
    { pubkey: args.freeze, isSigner: false, isWritable: false },
    { pubkey: args.gatewayConfig, isSigner: false, isWritable: false },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
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

export async function runLivePermissionlessMint(): Promise<LivePermissionlessMintProof> {
  const conn = new Connection(RPC_DEFAULT, "confirmed");
  const stack = await ensurePassportCommerceStack(conn);

  const payer = Keypair.generate();
  const owner = Keypair.generate();
  assert.notEqual(
    payer.publicKey.toBase58(),
    stack.passportAuthority.publicKey.toBase58(),
    "permissionless: payer must ≠ passport config authority",
  );
  await airdrop(conn, payer, 5);
  await airdrop(conn, owner, 1);

  const cfgBefore = (await conn.getAccountInfo(stack.passportConfig))!.data as Buffer;
  const nextBefore = Buffer.from(
    cfgBefore.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
  );

  const minted = await mintPassportAsset(
    conn,
    stack,
    payer,
    owner.publicKey,
    "ar://permissionless-mint-proof",
  );

  const cfgAfter = (await conn.getAccountInfo(stack.passportConfig))!.data as Buffer;
  const nextAfter = Buffer.from(
    cfgAfter.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
  );
  assert.notDeepEqual(
    [...nextBefore],
    [...nextAfter],
    "next_token_id must advance",
  );

  const assetInfo = await conn.getAccountInfo(minted.asset);
  assert.ok(assetInfo, "Core asset missing after mint");
  const assetData = assetInfo!.data as Buffer;
  assert.equal(
    coreOwner(assetData).toBase58(),
    owner.publicKey.toBase58(),
    "Core owner = fresh owner",
  );
  const freezePlugin = permanentFreezePlugin(assetData);
  assert.ok(freezePlugin.authority, "PermanentFreeze Address authority required");
  assert.equal(
    freezePlugin.authority!.toBase58(),
    stack.gatewayFreeze.toBase58(),
    "PermanentFreeze authority = gateway freeze PDA",
  );
  assert.equal(freezePlugin.frozen, false, "mint leaves frozen=false");

  const stateInfo = await conn.getAccountInfo(minted.state);
  assert.ok(stateInfo, "PassportState missing");
  assert.equal(
    passportStateStatus(stateInfo!.data as Buffer),
    0,
    "PassportState UNVERIFIED",
  );

  // --- Validator refusal: foreign freeze → InvalidSeeds ---
  const cfgNow = (await conn.getAccountInfo(stack.passportConfig))!.data as Buffer;
  const tokenIdForeign = Buffer.from(
    cfgNow.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
  );
  const [assetForeign] = pda(stack.passportProgram, [SEED.asset, tokenIdForeign]);
  const [stateForeign] = pda(stack.passportProgram, [SEED.state, tokenIdForeign]);
  const foreignFreezeKey = Keypair.generate().publicKey;
  const foreignFreezeObs = await expectStandTransactionRefusal({
    conn,
    transaction: new Transaction().add(
      ix(
        stack.passportProgram,
        mintKeys({
          passportConfig: stack.passportConfig,
          asset: assetForeign,
          state: stateForeign,
          payer: payer.publicKey,
          owner: owner.publicKey,
          freeze: foreignFreezeKey,
          gatewayConfig: stack.gatewayConfig,
        }),
        Buffer.concat([
          Buffer.from([PASSPORT_IX.MintPassport]),
          encodeString("ar://foreign-freeze"),
        ]),
      ),
    ),
    signers: [payer],
    expected: { kind: "native", name: "InvalidSeeds" },
  });
  assert.equal(foreignFreezeObs.kind, "native");
  assert.equal(foreignFreezeObs.name, "InvalidSeeds");
  const foreignFreeze = "InvalidSeeds" as const;

  // --- Validator refusal: owner = gateway config PDA → InvalidReceiver ---
  const cfgRecv = (await conn.getAccountInfo(stack.passportConfig))!.data as Buffer;
  const tokenIdRecv = Buffer.from(
    cfgRecv.subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
  );
  const [assetRecv] = pda(stack.passportProgram, [SEED.asset, tokenIdRecv]);
  const [stateRecv] = pda(stack.passportProgram, [SEED.state, tokenIdRecv]);
  const ownerIsGatewayObs = await expectStandTransactionRefusal({
    conn,
    transaction: new Transaction().add(
      ix(
        stack.passportProgram,
        mintKeys({
          passportConfig: stack.passportConfig,
          asset: assetRecv,
          state: stateRecv,
          payer: payer.publicKey,
          owner: stack.gatewayConfig,
          freeze: stack.gatewayFreeze,
          gatewayConfig: stack.gatewayConfig,
        }),
        Buffer.concat([
          Buffer.from([PASSPORT_IX.MintPassport]),
          encodeString("ar://owner-is-gateway"),
        ]),
      ),
    ),
    signers: [payer],
    expected: { kind: "custom", name: "InvalidReceiver" },
  });
  assert.equal(ownerIsGatewayObs.kind, "custom");
  assert.equal(ownerIsGatewayObs.name, "InvalidReceiver");
  const ownerIsGateway = "InvalidReceiver" as const;

  return withStandArtifactBindings({
    payerEqualsAuthority: false as const,
    owner: owner.publicKey.toBase58(),
    gatewayFreeze: stack.gatewayFreeze.toBase58(),
    freezeAuthority: freezePlugin.authority!.toBase58(),
    frozen: false as const,
    passportStatus: 0 as const,
    nextTokenIdAdvanced: true as const,
    refusals: {
      foreignFreeze,
      ownerIsGateway,
    },
    note: "BridgeGatewayUnbound is admit/cargo-only; stand binds gateway at init" as const,
  });
}
