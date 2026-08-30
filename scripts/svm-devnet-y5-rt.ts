/**
 * S4b Y5 — live round-trip hub (40245 / N7) ↔ Solana Devnet (40168).
 *
 * 1. Mint home passport on N7 with real `ar://` URI
 * 2. Hub→Solana SEND_AND_COMPOSE; poll Core asset on Devnet
 * 3. Solana→hub production send CPI; poll hub owner restored
 *
 * Never logs key material. No Solana COMMERCIAL_ACTIVE.
 *
 *   pnpm svm:y5-rt
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { Options } from "@layerzerolabs/lz-v2-utilities";
import {
  SendHelper,
  generateAddressLookupTable,
  txWithAddressLookupTable,
} from "@layerzerolabs/lz-solana-sdk-v2";
import {
  getAddress,
  padHex,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";

import {
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
} from "../lib/contracts/abis.generated.ts";
import {
  SOLANA_DEVNET_ENFORCED_COMPUTE,
  SOLANA_DEVNET_ENFORCED_RENT_LAMPORTS,
} from "../lib/web3/bridge/lz-receive-gas.ts";
import { protocolAddressToBytes32 } from "../lib/web3/protocol-address.ts";
import {
  createHubDeployerClients,
  writeContractLocal,
} from "./lib/deployer-viem.ts";
import { EID_HUB, EID_SOLANA_DEVNET } from "./lib/layerzero-metadata.ts";
import { onftSentGuidFromLogs } from "./lib/onft-sent.ts";
import { requireSepoliaDeployment, requireSvmDevnetEvidence } from "./lib/load-deployment.ts";
import { materializeSolanaDeployer } from "./lib/svm-materialize-deployer.ts";

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
  ComputeBudgetProgram,
} = loadWeb3();

const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const ASSET_SEED = Buffer.from("asset");
const STATE_SEED = Buffer.from("state");
const CONFIG_SEED = Buffer.from("config");
const FREEZE_SEED = Buffer.from("freeze");
const PEER_SEED = Buffer.from("Peer");
const DELIVERY_TIMEOUT_MS = 15 * 60 * 1000;
const DELIVERY_POLL_MS = 10_000;
const SCAN_TESTNET_BASE = "https://scan-testnet.layerzero-api.com/v1";

/** Real Arweave-shaped URI under declared ceiling (160). */
const RT_URI = "ar://s4b-y5-rt-2026-08-30-n7-devnet";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

function fail(msg: string): never {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}

function pda(seeds: Buffer[], programId: InstanceType<typeof PublicKey>) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function tokenIdToBytes32(tokenId: bigint): Uint8Array {
  const hex = tokenId.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function gatewaySendData(args: {
  dstEid: number;
  to: Uint8Array;
  tokenId: Uint8Array;
  nativeFee: bigint;
  options: Uint8Array;
}): Buffer {
  const eid = Buffer.alloc(4);
  eid.writeUInt32LE(args.dstEid, 0);
  const fee = Buffer.alloc(8);
  fee.writeBigUInt64LE(args.nativeFee, 0);
  const optLen = Buffer.alloc(4);
  optLen.writeUInt32LE(args.options.length, 0);
  return Buffer.concat([
    Buffer.from([1]),
    eid,
    Buffer.from(args.to),
    Buffer.from(args.tokenId),
    fee,
    optLen,
    Buffer.from(args.options),
  ]);
}

async function pollUntil(
  label: string,
  predicate: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      if (await predicate()) {
        console.log(`  … ${label}: ok (attempt ${attempt})`);
        return;
      }
    } catch {
      /* transient */
    }
    const remaining = Math.max(0, deadline - Date.now());
    console.log(
      `  … ${label}: waiting (${attempt}, ${Math.ceil(remaining / 1000)}s left)`,
    );
    await new Promise((r) => setTimeout(r, DELIVERY_POLL_MS));
  }
  fail(`${label}: timeout after ${DELIVERY_TIMEOUT_MS / 1000}s`);
}

async function fetchScanStatus(guid: Hex): Promise<string | null> {
  try {
    const res = await fetch(`${SCAN_TESTNET_BASE}/messages/guid/${guid}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return `http_${res.status}`;
    const body = (await res.json()) as {
      data?: Array<{ status?: { name?: string; message?: string } | string }>;
    };
    const first = body.data?.[0];
    if (!first) return "empty";
    const status = first.status;
    if (typeof status === "string") return status;
    return status?.name ?? status?.message ?? JSON.stringify(status);
  } catch (err) {
    return `unreachable (${err instanceof Error ? err.message : String(err)})`;
  }
}

/**
 * Testnet LZ committer often stalls after DVN quorum. Anyone may
 * `commitVerification` then `lzReceive` once the payload hash is on the Endpoint.
 */
async function nudgeHubDelivery(
  svmSendSig: string,
  hub: ReturnType<typeof createHubDeployerClients>,
  hubGateway: Address,
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 8_000));
    const res = await fetch(`${SCAN_TESTNET_BASE}/messages/tx/${svmSendSig}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as {
      data?: Array<{
        guid?: string;
        destination?: { status?: string };
        verification?: {
          sealer?: { status?: string };
          dvn?: {
            status?: string;
            dvns?: Record<
              string,
              { proof?: { packetHeader?: string; payloadHash?: string } }
            >;
          };
        };
        source?: { tx?: { payload?: string } };
        pathway?: { nonce?: number };
      }>;
    };
    const m = body.data?.[0];
    if (!m) continue;
    if (m.destination?.status === "SUCCEEDED") return;
    const dvnOk = m.verification?.dvn?.status === "SUCCEEDED";
    if (!dvnOk) continue;
    const proof = Object.values(m.verification?.dvn?.dvns ?? {})[0]?.proof;
    if (!proof?.packetHeader || !proof?.payloadHash) continue;

    const receiveUln = getAddress(
      "0x12523de19dc41c91F7d2093E0CFbB76b17012C8d",
    );
    if (m.verification?.sealer?.status !== "SUCCEEDED") {
      try {
        await writeContractLocal(hub, {
          address: receiveUln,
          abi: parseAbi([
            "function commitVerification(bytes calldata _packetHeader, bytes32 _payloadHash)",
          ]),
          functionName: "commitVerification",
          args: [proof.packetHeader as Hex, proof.payloadHash as Hex],
        });
        console.log("  hub commitVerification ok");
      } catch (err) {
        console.log(
          `  commit soft-fail: ${err instanceof Error ? err.message.slice(0, 100) : err}`,
        );
      }
    }

    const guid = m.guid as Hex | undefined;
    const payload = m.source?.tx?.payload as Hex | undefined;
    const nonce = BigInt(m.pathway?.nonce ?? 0);
    if (!guid || !payload || nonce === 0n) continue;

    const { loadLayerZeroMetadataSnapshot } = await import(
      "./lib/layerzero-metadata.ts"
    );
    const snap = loadLayerZeroMetadataSnapshot();
    const ep = getAddress(snap.chains[EID_HUB]!.endpointV2);
    const sender = padHex(
      `0x${Buffer.from(
        PublicKey.findProgramAddressSync(
          [CONFIG_SEED],
          new PublicKey(
            requireSvmDevnetEvidence(EID_SOLANA_DEVNET).programs.kar_gateway
              .programId,
          ),
        )[0].toBytes(),
      ).toString("hex")}`,
      { size: 32 },
    ) as Hex;
    try {
      await writeContractLocal(hub, {
        address: ep,
        abi: parseAbi([
          "function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, address _receiver, bytes32 _guid, bytes _message, bytes _extraData) payable",
        ]),
        functionName: "lzReceive",
        args: [
          { srcEid: EID_SOLANA_DEVNET, sender, nonce },
          hubGateway,
          guid,
          payload,
          "0x",
        ],
      });
      console.log("  hub lzReceive ok");
      return;
    } catch (err) {
      console.log(
        `  lzReceive soft-fail: ${err instanceof Error ? err.message.slice(0, 100) : err}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const rpc = requireEnv("SOLANA_RPC_URL");
  const hubManifest = requireSepoliaDeployment();
  const evidence = requireSvmDevnetEvidence(EID_SOLANA_DEVNET);
  const hubPassport = getAddress(hubManifest.karPassport);
  const hubGateway = getAddress(hubManifest.bridgeGateway!);
  const gatewayId = new PublicKey(evidence.programs.kar_gateway.programId);
  const passportId = new PublicKey(evidence.programs.kar_passport.programId);
  const gatewayConfig = pda([CONFIG_SEED], gatewayId);
  const passportConfig = pda([CONFIG_SEED], passportId);
  const freeze = pda([FREEZE_SEED], gatewayId);
  const peerConfig = pda(
    [
      PEER_SEED,
      gatewayConfig.toBytes(),
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(EID_HUB, 0);
        return b;
      })(),
    ],
    gatewayId,
  );

  const hub = createHubDeployerClients();
  const deployer = getAddress(hub.account.address);
  const resumeTokenId = process.env.Y5_RESUME_TOKEN_ID?.trim();
  console.log("S4b Y5 live RT");
  console.log(`  hub passport=${hubPassport}`);
  console.log(`  hub gateway=${hubGateway}`);
  console.log(`  svm gateway=${gatewayId.toBase58()}`);
  console.log(`  uri=${RT_URI} (${Buffer.byteLength(RT_URI, "utf8")} bytes)`);
  console.log(
    `  enforced compute=${SOLANA_DEVNET_ENFORCED_COMPUTE} rent=${SOLANA_DEVNET_ENFORCED_RENT_LAMPORTS}`,
  );
  if (resumeTokenId) console.log(`  resume tokenId=${resumeTokenId}`);

  let tokenId: bigint;
  let skipHubSend = false;
  if (resumeTokenId) {
    tokenId = BigInt(resumeTokenId);
    skipHubSend = true;
    console.log("\n(1)+(2) skipped (Y5_RESUME_TOKEN_ID)");
  } else {
    // --- mint ---
    console.log("\n(1) mintPassport on N7…");
    const { hash: mintHash, receipt: mintReceipt } = await writeContractLocal(hub, {
      address: hubPassport,
      abi: KarPassportAbi,
      functionName: "mintPassport",
      args: [deployer, RT_URI],
    });
    const minted = parseEventLogs({
      abi: KarPassportAbi,
      eventName: "PassportMinted",
      logs: mintReceipt.logs,
    });
    if (minted.length === 0) fail("PassportMinted not found in mint receipt");
    tokenId = minted[0]!.args.tokenId as bigint;
    console.log(`  minted tokenId=${tokenId} tx=${mintHash}`);

    let uriOnChain = "";
    for (let i = 0; i < 30; i++) {
      try {
        uriOnChain = (await hub.public.readContract({
          address: hubPassport,
          abi: KarPassportAbi,
          functionName: "tokenURI",
          args: [tokenId],
        })) as string;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    if (uriOnChain !== RT_URI) {
      fail(`tokenURI mismatch after mint: got ${uriOnChain || "(unread)"}`);
    }

    const approved = (await hub.public.readContract({
      address: hubPassport,
      abi: KarPassportAbi,
      functionName: "isApprovedForAll",
      args: [deployer, hubGateway],
    })) as boolean;
    if (!approved) {
      console.log("  setApprovalForAll(gateway)…");
      await writeContractLocal(hub, {
        address: hubPassport,
        abi: KarPassportAbi,
        functionName: "setApprovalForAll",
        args: [hubGateway, true],
      });
    }
  }

  // --- hub → Solana (or resume from foreign mint) ---
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
    const solPayer = Keypair.fromSecretKey(secret);
    const connection = new Connection(rpc, "confirmed");
    const solRecipient = solPayer.publicKey;
    const toBytes32 = padHex(`0x${Buffer.from(solRecipient.toBytes()).toString("hex")}`, {
      size: 32,
    }) as Hex;

    const tokenIdBytes = tokenIdToBytes32(tokenId);
    const asset = pda([ASSET_SEED, Buffer.from(tokenIdBytes)], passportId);
    const state = pda([STATE_SEED, Buffer.from(tokenIdBytes)], passportId);
    console.log(`  expect asset=${asset.toBase58()}`);

    if (!skipHubSend) {
      // Pathway enforcedOptions already pin compute+rent. Do not re-add native
      // drop here — Executor_NativeAmountExceedsCap (cap 20e6 lamports on Devnet).
      const extraOptions = "0x" as Hex;

      const sendParam = {
        dstEid: EID_SOLANA_DEVNET,
        to: toBytes32,
        tokenId,
        extraOptions,
        composeMsg: "0x" as Hex,
        onftCmd: "0x" as Hex,
      };

      console.log("\n(2) hub→Solana quoteSend + send…");
      const fee = (await hub.public.readContract({
        address: hubGateway,
        abi: KarPassportBridgeGatewayAbi,
        functionName: "quoteSend",
        args: [sendParam, false],
      })) as { nativeFee: bigint; lzTokenFee: bigint };
      console.log(`  fee=${fee.nativeFee.toString()} wei`);

      const { hash: sendHash, receipt } = await writeContractLocal(hub, {
        address: hubGateway,
        abi: KarPassportBridgeGatewayAbi,
        functionName: "send",
        args: [sendParam, fee, deployer],
        value: fee.nativeFee,
      });
      const guid = onftSentGuidFromLogs(KarPassportBridgeGatewayAbi, receipt.logs);
      console.log(`  send tx=${sendHash}`);
      console.log(`  guid=${guid}`);

      console.log("\n(3) poll Solana foreign mint…");
      await pollUntil("hub→svm delivery", async () => {
        const info = await connection.getAccountInfo(asset);
        return info != null && info.data.length > 0;
      });
      const scanOut = await fetchScanStatus(guid);
      console.log(`  scan status=${scanOut}`);
    } else {
      console.log("\n(3) confirm foreign mint present…");
      const info = await connection.getAccountInfo(asset);
      if (info == null || info.data.length === 0) {
        fail(`resume asset missing: ${asset.toBase58()}`);
      }
    }
    console.log(`  asset live; state=${state.toBase58()}`);

    // --- Solana → hub ---
    console.log("\n(4) Solana→hub production send…");
    const hubPeer = protocolAddressToBytes32("evm", hubGateway);
    if (hubPeer == null) fail("hub peer bytes32 failed");
    // ONFT sendTo = destination owner (hub deployer), NOT the gateway peer.
    const hubTo = Buffer.alloc(32);
    Buffer.from(deployer.slice(2), "hex").copy(hubTo, 12);
    // SendHelper receiver = bytes32 peer as base58 (hub gateway).
    const hubReceiverB58 = new PublicKey(
      Buffer.from(hubPeer.slice(2), "hex"),
    ).toBase58();

    const hubReceiveOptions = Buffer.from(
      Options.newOptions()
        .addExecutorLzReceiveOption(100_000, 0)
        .toBytes(),
    );

    const sendAccounts = await new SendHelper().getSendAccounts(
      connection,
      solPayer.publicKey,
      gatewayConfig,
      EID_HUB,
      hubReceiverB58,
    );
    // construct_context: [0]=endpoint program, [1]=sender → gateway remaining = slice(2)
    const endpointMetas = sendAccounts.slice(2).map((a) => ({
      pubkey: a.pubkey,
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    }));

    // Overpay native fee; ULN refunds excess to payer in remaining accounts.
    const nativeFee = 50_000_000n; // 0.05 SOL

    const keys = [
      { pubkey: gatewayConfig, isSigner: false, isWritable: true },
      { pubkey: solPayer.publicKey, isSigner: true, isWritable: false },
      { pubkey: solPayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: passportId, isSigner: false, isWritable: false },
      { pubkey: passportConfig, isSigner: false, isWritable: true },
      { pubkey: asset, isSigner: false, isWritable: true },
      { pubkey: state, isSigner: false, isWritable: true },
      { pubkey: freeze, isSigner: false, isWritable: true },
      { pubkey: CORE_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: peerConfig, isSigner: false, isWritable: false },
      ...endpointMetas,
    ];

    const ix = new TransactionInstruction({
      programId: gatewayId,
      keys,
      data: gatewaySendData({
        dstEid: EID_HUB,
        to: hubTo,
        tokenId: tokenIdBytes,
        nativeFee,
        options: hubReceiveOptions,
      }),
    });

    // Legacy Transaction exceeds 1232 with ULN remaining accounts — use ALT + v0.
    const altAddrs = [
      ...new Map(keys.map((k) => [k.pubkey.toBase58(), k.pubkey])).values(),
    ];
    console.log(`  creating ALT for ${altAddrs.length} accounts…`);
    const { instructions: altIxs, address: altAddress } =
      await generateAddressLookupTable(
        connection,
        solPayer.publicKey,
        solPayer.publicKey,
        altAddrs,
      );
    const altCreateTx = new Transaction().add(...altIxs);
    const altSig = await sendAndConfirmTransaction(
      connection,
      altCreateTx,
      [solPayer],
      { commitment: "confirmed" },
    );
    console.log(`  ALT=${altAddress.toBase58()} sig=${altSig.slice(0, 12)}…`);
    // ALT is usable only after the create slot is finalized enough for the bank.
    await new Promise((r) => setTimeout(r, 2_500));

    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const vtx = await txWithAddressLookupTable(
      connection,
      solPayer.publicKey,
      [cuIx, ix],
      blockhash,
      altAddress,
    );
    vtx.sign([solPayer]);
    const returnSig = await connection.sendTransaction(vtx, {
      skipPreflight: false,
      maxRetries: 5,
    });
    await connection.confirmTransaction(
      { signature: returnSig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    console.log(`  svm send sig=${returnSig.slice(0, 16)}…`);

    // Confirm asset burned — Core leaves a 1-byte tombstone (D-17), not a full close.
    await pollUntil("svm debit", async () => {
      const info = await connection.getAccountInfo(asset);
      return info == null || info.data.length <= 1;
    });

    console.log("\n(5) poll hub unlock…");
    // Testnet committer often stalls after DVN quorum — commit + lzReceive ourselves.
    void nudgeHubDelivery(returnSig, hub, hubGateway).catch((err) => {
      console.log(
        `  hub nudge soft-fail: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
      );
    });
    await pollUntil("svm→hub delivery", async () => {
      try {
        const owner = getAddress(
          (await hub.public.readContract({
            address: hubPassport,
            abi: KarPassportAbi,
            functionName: "ownerOf",
            args: [tokenId],
          })) as Address,
        );
        return owner === deployer;
      } catch {
        return false;
      }
    });

    const uriAfter = (await hub.public.readContract({
      address: hubPassport,
      abi: KarPassportAbi,
      functionName: "tokenURI",
      args: [tokenId],
    })) as string;
    const statusAfter = Number(
      await hub.public.readContract({
        address: hubPassport,
        abi: KarPassportAbi,
        functionName: "passportStatus",
        args: [tokenId],
      }),
    );
    console.log(`  hub owner=${deployer} uri=${uriAfter} status=${statusAfter}`);
    if (uriAfter !== RT_URI) {
      fail(`URI not preserved on return: ${uriAfter}`);
    }

    console.log("\n==> Y5 live RT PASS (both directions)");
    console.log(
      `  measure pin: compute_floor=${SOLANA_DEVNET_ENFORCED_COMPUTE} rent_lamports=${SOLANA_DEVNET_ENFORCED_RENT_LAMPORTS}`,
    );
  } finally {
    shred();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
