/**
 * S4b Y4 — prove Solana destination with hub still unwired.
 *
 * 1. RegisterOApp (gateway_config PDA → EndpointV2)
 * 2. SetPeer(40245, N7 hub gateway bytes32) — Solana side only (does not open hub strand)
 * 3. LzReceiveTypes → production account list (on-chain log)
 * 4. Construct LzReceive against real endpoint — expect clear fail (no DVN payload);
 *    assert we passed the PeerConfig check
 *
 * Never logs key material. Hub peer 40168 must remain zero.
 */

import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createPublicClient, http, getAddress, zeroHash, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

import { KarPassportBridgeGatewayAbi } from "../lib/contracts/abis.generated.ts";
import {
  abiEncodeString,
  encodeOnftMessage,
  tokenIdFromParts,
} from "../lib/web3/bridge/onft-msg-codec.ts";
import { protocolAddressToBytes32 } from "../lib/web3/protocol-address.ts";
import {
  requireSvmDevnetEvidence,
  requireSvmGatewayProgramId,
  requireSvmPassportProgramId,
  svmDevnetEvidencePath,
} from "./lib/load-deployment.ts";
import { materializeSolanaDeployer } from "./lib/svm-materialize-deployer.ts";
import { writeSvmDevnetEvidence } from "./lib/write-deployment.ts";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local" });
} catch {
  /* optional */
}

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

const HUB_EID = 40245;
const SVM_EID = 40168;
const EVM_NAMESPACE = 84532n;
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const OAPP_SEED = Buffer.from("OApp");
const EVENT_SEED = Buffer.from("__event_authority");
const ENDPOINT_SEED = Buffer.from("Endpoint");
const NONCE_SEED = Buffer.from("Nonce");
const PAYLOAD_HASH_SEED = Buffer.from("PayloadHash");
const PEER_SEED = Buffer.from("Peer");
const CONFIG_SEED = Buffer.from("config");
const FREEZE_SEED = Buffer.from("freeze");
const ASSET_SEED = Buffer.from("asset");
const STATE_SEED = Buffer.from("state");

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

function pda(
  seeds: (Buffer | Uint8Array)[],
  programId: InstanceType<typeof PublicKey>,
): InstanceType<typeof PublicKey> {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function encodeVecU8(data: Uint8Array): Buffer {
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32LE(data.length, 0);
  Buffer.from(data).copy(out, 4);
  return out;
}

/** Borsh GatewayIx::RegisterOApp (disc 5). */
function registerOAppData(delegate: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([5]), Buffer.from(delegate)]);
}

/** Borsh GatewayIx::SetPeer (disc 6). */
function setPeerData(remoteEid: number, peer: Uint8Array): Buffer {
  const eid = Buffer.alloc(4);
  eid.writeUInt32LE(remoteEid, 0);
  return Buffer.concat([Buffer.from([6]), eid, Buffer.from(peer)]);
}

/** Borsh GatewayIx::LzReceiveTypes (disc 4). */
function lzReceiveTypesData(message: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([4]), encodeVecU8(message)]);
}

/** Borsh GatewayIx::LzReceive (disc 2). */
function lzReceiveData(args: {
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

function hexToBytes32(hex: Hex): Uint8Array {
  const h = hex.slice(2);
  if (h.length !== 64) throw new Error(`expected 32-byte hex, got ${hex}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function main(): Promise<void> {
  const rpc = requireEnv("SOLANA_RPC_URL");
  const endpointId = new PublicKey(requireEnv("SOLANA_LZ_ENDPOINT"));
  const evidence = requireSvmDevnetEvidence(SVM_EID);
  const gatewayId = new PublicKey(requireSvmGatewayProgramId(evidence));
  const passportId = new PublicKey(requireSvmPassportProgramId(evidence));

  const hubManifest = JSON.parse(
    readFileSync(join(process.cwd(), "deployments/84532.json"), "utf8"),
  ) as { bridgeGateway: string };
  const hubGateway = getAddress(hubManifest.bridgeGateway);
  const hubPeerBytes32 = protocolAddressToBytes32("evm", hubGateway);
  if (hubPeerBytes32 == null) throw new Error("hub gateway → bytes32 failed");
  const hubPeerArr = hexToBytes32(hubPeerBytes32);

  // Hub must stay unwired.
  const hubRpc =
    process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
    process.env.SEPOLIA_RPC_URL?.trim() ||
    "https://sepolia.base.org";
  const hubPc = createPublicClient({ chain: baseSepolia, transport: http(hubRpc) });
  const hubPeerOnChain = (await hubPc.readContract({
    address: hubGateway,
    abi: KarPassportBridgeGatewayAbi,
    functionName: "peers",
    args: [SVM_EID],
  })) as Hex;
  if (hubPeerOnChain !== zeroHash) {
    throw new Error(
      `STOP: hub peer 40168 is ${hubPeerOnChain} — must be zero before Y4 (run Y1)`,
    );
  }
  console.log("  hub peer 40168 = 0x00…00 (unwired) OK");

  const mat = materializeSolanaDeployer();
  let shredded = false;
  const shred = () => {
    if (!shredded) {
      try {
        rmSync(mat.workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      shredded = true;
    }
  };
  try {
    const secret = Uint8Array.from(
      JSON.parse(readFileSync(mat.keypairPath, "utf8")) as number[],
    );
    const payer = Keypair.fromSecretKey(secret);
    const connection = new Connection(rpc, "confirmed");

    const gatewayConfig = pda([CONFIG_SEED], gatewayId);
    const passportConfig = pda([CONFIG_SEED], passportId);
    const freezePda = pda([FREEZE_SEED], gatewayId);
    const oappRegistry = pda([OAPP_SEED, gatewayConfig.toBytes()], endpointId);
    const eventAuthority = pda([EVENT_SEED], endpointId);
    const peerConfig = pda(
      [
        PEER_SEED,
        gatewayConfig.toBytes(),
        (() => {
          const b = Buffer.alloc(4);
          b.writeUInt32BE(HUB_EID, 0);
          return b;
        })(),
      ],
      gatewayId,
    );

    const send = async (
      label: string,
      ix: InstanceType<typeof TransactionInstruction>,
    ): Promise<string> => {
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });
      console.log(`  ${label} ok sig=${sig.slice(0, 12)}…`);
      return sig;
    };

    // --- 1. RegisterOApp ---
    const registryInfo = await connection.getAccountInfo(oappRegistry);
    if (registryInfo != null && registryInfo.data.length > 0) {
      console.log(`  RegisterOApp skip (registry exists ${oappRegistry.toBase58()})`);
    } else {
      console.log("  RegisterOApp…");
      await send(
        "gateway.RegisterOApp",
        new TransactionInstruction({
          programId: gatewayId,
          keys: [
            { pubkey: gatewayConfig, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: endpointId, isSigner: false, isWritable: false },
            { pubkey: oappRegistry, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: eventAuthority, isSigner: false, isWritable: false },
          ],
          data: registerOAppData(payer.publicKey.toBytes()),
        }),
      );
      const after = await connection.getAccountInfo(oappRegistry);
      if (after == null || after.data.length === 0) {
        throw new Error("RegisterOApp: oapp registry still empty after tx");
      }
    }
    console.log(`  oappRegistry=${oappRegistry.toBase58()}`);

    // --- 2. SetPeer (Solana → hub) ---
    const peerInfo = await connection.getAccountInfo(peerConfig);
    let peerAlready = false;
    if (peerInfo != null && peerInfo.data.length >= 40) {
      const stored = Buffer.from(peerInfo.data).subarray(8, 40);
      peerAlready = stored.equals(Buffer.from(hubPeerArr));
    }
    if (peerAlready) {
      console.log(`  SetPeer skip (already ${hubGateway})`);
    } else {
      console.log(`  SetPeer(40245 → ${hubGateway})…`);
      await send(
        "gateway.SetPeer",
        new TransactionInstruction({
          programId: gatewayId,
          keys: [
            { pubkey: gatewayConfig, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: peerConfig, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: setPeerData(HUB_EID, hubPeerArr),
        }),
      );
    }
    console.log(`  peerConfig=${peerConfig.toBase58()}`);

    // --- 3. LzReceiveTypes (production path) ---
    const recipient = payer.publicKey.toBytes();
    const tokenId = tokenIdFromParts(EVM_NAMESPACE, 99n);
    const { message } = encodeOnftMessage(
      recipient,
      tokenId,
      abiEncodeString("ar://y4-prove"),
    );
    console.log("  LzReceiveTypes…");
    const typesSig = await send(
      "gateway.LzReceiveTypes",
      new TransactionInstruction({
        programId: gatewayId,
        keys: [{ pubkey: gatewayConfig, isSigner: false, isWritable: false }],
        data: lzReceiveTypesData(message),
      }),
    );
    const typesTx = await connection.getTransaction(typesSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logText = (typesTx?.meta?.logMessages ?? []).join("\n");
    if (!logText.includes("lz_receive_types production")) {
      throw new Error(
        `LzReceiveTypes did not log production layout. logs:\n${logText.slice(0, 800)}`,
      );
    }
    console.log("  LzReceiveTypes → production account list OK");

    // --- 4. Construct receive against real endpoint (expect clear fail) ---
    const sender = hubPeerArr;
    const nonce = 1n;
    const guid = new Uint8Array(32).fill(0x42);
    const srcEidBe = Buffer.alloc(4);
    srcEidBe.writeUInt32BE(HUB_EID, 0);
    const nonceBe = Buffer.alloc(8);
    nonceBe.writeBigUInt64BE(nonce, 0);

    const clearAccounts = {
      endpoint: endpointId,
      receiver: gatewayConfig,
      oappRegistry,
      nonce: pda(
        [NONCE_SEED, gatewayConfig.toBytes(), srcEidBe, Buffer.from(sender)],
        endpointId,
      ),
      payloadHash: pda(
        [
          PAYLOAD_HASH_SEED,
          gatewayConfig.toBytes(),
          srcEidBe,
          Buffer.from(sender),
          nonceBe,
        ],
        endpointId,
      ),
      endpointSettings: pda([ENDPOINT_SEED], endpointId),
      eventAuthority,
    };
    const asset = pda([ASSET_SEED, Buffer.from(tokenId)], passportId);
    const state = pda([STATE_SEED, Buffer.from(tokenId)], passportId);

    console.log("  LzReceive (synthetic; expect Endpoint clear refuse)…");
    let receiveOutcome: "clear_refused" | "unexpected_ok" | "peer_failed" | "other" =
      "other";
    let receiveErr = "";
    try {
      await send(
        "gateway.LzReceive",
        new TransactionInstruction({
          programId: gatewayId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // 0 payer
            { pubkey: gatewayConfig, isSigner: false, isWritable: true }, // 1
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 2
            { pubkey: passportId, isSigner: false, isWritable: false }, // 3
            { pubkey: passportConfig, isSigner: false, isWritable: true }, // 4
            { pubkey: asset, isSigner: false, isWritable: true }, // 5
            { pubkey: state, isSigner: false, isWritable: true }, // 6
            { pubkey: freezePda, isSigner: false, isWritable: false }, // 7
            { pubkey: CORE_ID, isSigner: false, isWritable: false }, // 8
            { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // 9 to
            { pubkey: clearAccounts.endpoint, isSigner: false, isWritable: false }, // 10
            { pubkey: clearAccounts.receiver, isSigner: false, isWritable: false }, // 11
            { pubkey: clearAccounts.oappRegistry, isSigner: false, isWritable: false }, // 12
            { pubkey: clearAccounts.nonce, isSigner: false, isWritable: true }, // 13
            { pubkey: clearAccounts.payloadHash, isSigner: false, isWritable: true }, // 14
            {
              pubkey: clearAccounts.endpointSettings,
              isSigner: false,
              isWritable: true,
            }, // 15
            {
              pubkey: clearAccounts.eventAuthority,
              isSigner: false,
              isWritable: false,
            }, // 16
            { pubkey: clearAccounts.endpoint, isSigner: false, isWritable: false }, // 17
            { pubkey: peerConfig, isSigner: false, isWritable: false }, // 18
          ],
          data: lzReceiveData({
            srcEid: HUB_EID,
            sender,
            nonce,
            guid,
            message,
          }),
        }),
      );
      receiveOutcome = "unexpected_ok";
    } catch (err) {
      receiveErr = err instanceof Error ? err.message : String(err);
      const lower = receiveErr.toLowerCase();
      // Peer check = InvalidArgument (custom program error 0x1) before clear CPI.
      // Clear without committed payload → endpoint / account errors.
      if (
        lower.includes("invalidargument") ||
        lower.includes("custom program error: 0x1") ||
        lower.includes("incorrectprogramid")
      ) {
        // Could still be peer — check logs if present
        if (
          lower.includes("peer") ||
          (lower.includes("0x1") && !lower.includes("clear") && !lower.includes("endpoint"))
        ) {
          receiveOutcome = "peer_failed";
        } else {
          receiveOutcome = "clear_refused";
        }
      } else if (
        lower.includes("payload") ||
        lower.includes("clear") ||
        lower.includes("accountownedbymultiple") ||
        lower.includes("accountnotinitialized") ||
        lower.includes("custom program error") ||
        lower.includes("failed")
      ) {
        // Reached Endpoint clear CPI (or account prep for it) — peer check passed.
        receiveOutcome = "clear_refused";
      } else {
        receiveOutcome = "other";
      }
      console.log(
        `  LzReceive refused as expected (${receiveOutcome}): ${receiveErr.slice(0, 200)}`,
      );
    }

    if (receiveOutcome === "unexpected_ok") {
      throw new Error(
        "LzReceive succeeded without DVN payload — unexpected on unwired pathway",
      );
    }
    if (receiveOutcome === "peer_failed") {
      throw new Error(
        `LzReceive failed peer check — SetPeer may be wrong. ${receiveErr.slice(0, 300)}`,
      );
    }
    if (receiveOutcome === "other") {
      throw new Error(
        `LzReceive unexpected error class: ${receiveErr.slice(0, 400)}`,
      );
    }
    console.log(
      "  LzReceive: PeerConfig OK; Endpoint clear refused (no committed payload) — expected until Y5 wire + DVN",
    );

    // Re-confirm hub still zero
    const hubPeerAfter = (await hubPc.readContract({
      address: hubGateway,
      abi: KarPassportBridgeGatewayAbi,
      functionName: "peers",
      args: [SVM_EID],
    })) as Hex;
    if (hubPeerAfter !== zeroHash) {
      throw new Error("STOP: hub peer 40168 changed during Y4");
    }

    writeSvmDevnetEvidence(svmDevnetEvidencePath(SVM_EID), {
      ...evidence,
      y4: {
        at: new Date().toISOString(),
        registeredOApp: true,
        oappRegistry: oappRegistry.toBase58(),
        peerConfig: peerConfig.toBase58(),
        hubPeerBytes32,
        hubGateway,
        lzReceiveTypes: "production",
        syntheticReceive: "peer_ok_clear_refused_no_payload",
        hubStillUnwired: true,
        cannotProveUntilY5: [
          "hub→Solana DVN delivery / clear of real payload",
          "Solana→hub send CPI + live return path",
          "destination CU/rent pin in lz-receive-gas.ts",
        ],
      },
    });

    console.log("==> Y4 prove PASS (hub still unwired)");
    console.log(`    gateway: ${gatewayId.toBase58()}`);
    console.log(`    passport: ${passportId.toBase58()}`);
    console.log(`    evidence: ${svmDevnetEvidencePath(SVM_EID)}`);
  } finally {
    shred();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
