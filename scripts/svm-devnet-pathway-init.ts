/**
 * S4b Y5 — init Endpoint send/receive library + nonce + ULN OApp config for hub pathway (40245).
 * Signed by OApp delegate (deployer). Never logs key material.
 *
 *   pnpm svm:pathway-init
 */

import { createRequire } from "node:module";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  EndpointProgram,
  SetConfigType,
  UlnProgram,
} from "@layerzerolabs/lz-solana-sdk-v2";
import { getAddress } from "viem";

import { protocolAddressToBytes32 } from "../lib/web3/protocol-address.ts";
import { loadLayerZeroMetadataSnapshot } from "./lib/layerzero-metadata.ts";
import { requireSvmDevnetEvidence } from "./lib/load-deployment.ts";
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
  Transaction,
  sendAndConfirmTransaction,
} = loadWeb3();

const HUB_EID = 40245;
const SVM_EID = 40168;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

function sortedPubkeys(keys: InstanceType<typeof PublicKey>[]) {
  return [...keys].sort((a, b) =>
    Buffer.compare(Buffer.from(a.toBytes()), Buffer.from(b.toBytes())),
  );
}

async function main(): Promise<void> {
  const rpc = requireEnv("SOLANA_RPC_URL");
  const endpointId = new PublicKey(requireEnv("SOLANA_LZ_ENDPOINT"));
  const evidence = requireSvmDevnetEvidence(SVM_EID);
  const gatewayId = new PublicKey(evidence.programs.kar_gateway.programId);
  const gatewayConfig = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    gatewayId,
  )[0];

  const snapshot = loadLayerZeroMetadataSnapshot();
  const svm = snapshot.chains[SVM_EID];
  if (!svm || svm.vm !== "svm") throw new Error("40168 SVM snapshot missing");
  const pathway = snapshot.pathways["40168-40245"];
  if (!pathway) throw new Error("40168-40245 pathway missing");

  const ulnProgram = new PublicKey(svm.sendUln302);
  const executorProgram = new PublicKey(svm.executor);
  const [executorConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("ExecutorConfig")],
    executorProgram,
  );
  const requiredDvns = sortedPubkeys(
    pathway.requiredDvnIds.map((id) => {
      const addr = svm.dvns[id];
      if (!addr) throw new Error(`DVN ${id} missing on 40168`);
      return new PublicKey(addr);
    }),
  );
  const confirmations = pathway.confirmations["40245→40168"];
  if (confirmations == null) throw new Error("missing 40245→40168 confirmations");

  const hubManifest = JSON.parse(
    readFileSync(join(process.cwd(), "deployments/84532.json"), "utf8"),
  ) as { bridgeGateway: string };
  const hubGateway = getAddress(hubManifest.bridgeGateway);
  const hubPeer = protocolAddressToBytes32("evm", hubGateway);
  if (hubPeer == null) throw new Error("hub peer bytes32 failed");
  const remoteOapp = Buffer.from(hubPeer.slice(2), "hex");

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
    const endpoint = new EndpointProgram.Endpoint(endpointId);
    const uln = new UlnProgram.Uln(ulnProgram);

    const send = async (
      label: string,
      ix: InstanceType<typeof import("@solana/web3.js").TransactionInstruction>,
    ) => {
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });
      console.log(`  ${label} ok sig=${sig.slice(0, 12)}…`);
    };

    const trySend = async (
      label: string,
      build: () =>
        | InstanceType<typeof import("@solana/web3.js").TransactionInstruction>
        | Promise<
            InstanceType<typeof import("@solana/web3.js").TransactionInstruction>
          >,
    ) => {
      try {
        await send(label, await build());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          /already in use|already initialized|0x0|SameValue|0x1772|custom program error: 0x1772/i.test(
            msg,
          )
        ) {
          console.log(`  ${label} skip (exists)`);
        } else {
          throw err;
        }
      }
    };

    console.log(`  gatewayConfig=${gatewayConfig.toBase58()}`);
    console.log(`  hub peer=${hubGateway}`);
    console.log(
      `  ULN DVNs=${requiredDvns.map((d) => d.toBase58().slice(0, 8)).join("+")} confirmations=${confirmations}`,
    );

    await trySend("endpoint.initSendLibrary", () =>
      endpoint.initSendLibrary(payer.publicKey, gatewayConfig, HUB_EID),
    );
    await trySend("endpoint.initReceiveLibrary", () =>
      endpoint.initReceiveLibrary(payer.publicKey, gatewayConfig, HUB_EID),
    );
    await trySend("endpoint.initOAppNonce", () =>
      endpoint.initOAppNonce(payer.publicKey, HUB_EID, gatewayConfig, remoteOapp),
    );

    await trySend("endpoint.setSendLibrary(ULN)", () =>
      endpoint.setSendLibrary(payer.publicKey, gatewayConfig, ulnProgram, HUB_EID),
    );
    await trySend("endpoint.setReceiveLibrary(ULN)", () =>
      endpoint.setReceiveLibrary(
        payer.publicKey,
        gatewayConfig,
        ulnProgram,
        HUB_EID,
        0,
      ),
    );

    await trySend("endpoint.initOAppConfig(ULN)", () =>
      endpoint.initOAppConfig(
        payer.publicKey,
        uln,
        payer.publicKey,
        gatewayConfig,
        HUB_EID,
      ),
    );

    const ulnConfig = {
      confirmations,
      requiredDvnCount: requiredDvns.length,
      optionalDvnCount: 0,
      optionalDvnThreshold: 0,
      requiredDvns,
      optionalDvns: [] as InstanceType<typeof PublicKey>[],
    };

    await trySend("setOappConfig SEND_ULN", async () =>
      endpoint.setOappConfig(
        connection,
        payer.publicKey,
        gatewayConfig,
        ulnProgram,
        HUB_EID,
        { configType: SetConfigType.SEND_ULN, value: ulnConfig },
      ),
    );
    await trySend("setOappConfig RECEIVE_ULN", async () =>
      endpoint.setOappConfig(
        connection,
        payer.publicKey,
        gatewayConfig,
        ulnProgram,
        HUB_EID,
        { configType: SetConfigType.RECEIVE_ULN, value: ulnConfig },
      ),
    );
    await trySend("setOappConfig EXECUTOR", async () =>
      endpoint.setOappConfig(
        connection,
        payer.publicKey,
        gatewayConfig,
        ulnProgram,
        HUB_EID,
        {
          configType: SetConfigType.EXECUTOR,
          // SendHelper deserializes this as ExecutorConfig account data — must be the
          // ExecutorConfig PDA, not the executor program id.
          value: { maxMessageSize: 10_000, executor: executorConfig },
        },
      ),
    );

    const sendLib = await endpoint.getSendLibrary(connection, gatewayConfig, HUB_EID);
    const recvLib = await endpoint.getReceiveLibrary(connection, gatewayConfig, HUB_EID);
    console.log(
      `  sendLib default=${sendLib?.isDefault} program=${sendLib?.programId?.toBase58?.()}`,
    );
    console.log(
      `  recvLib default=${recvLib?.isDefault} program=${recvLib?.programId?.toBase58?.()}`,
    );

    try {
      const recvCfg = await uln.getReceiveConfigState(
        connection,
        gatewayConfig,
        HUB_EID,
      );
      if (recvCfg == null) {
        console.log("  oapp recv cfg still null after set");
      } else {
        console.log(
          `  oapp recv DVNs=${recvCfg.uln.requiredDvnCount} confirmations=${recvCfg.uln.confirmations.toString()}`,
        );
      }
    } catch (err) {
      console.log(
        `  oapp recv cfg read soft-fail: ${err instanceof Error ? err.message.slice(0, 80) : err}`,
      );
    }

    console.log("==> pathway init PASS");
  } finally {
    shred();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
