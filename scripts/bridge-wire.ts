/**
 * Bridge pathway wire CLI — hub (84532 / EID 40245) ↔ spoke (11155111 / EID 40161).
 *
 * Usage:
 *   pnpm bridge:wire              # write both sides (iteration 5)
 *   pnpm bridge:wire:read-only    # assert + table, zero txs
 *   pnpm bridge:wire --hub|--spoke [--read-only]
 *
 * Addresses from manifests + LayerZero metadata snapshot only — no hardcodes.
 */
import { createRequire } from "node:module";
import { config as loadEnv } from "dotenv";
import {
  decodeAbiParameters,
  getAddress,
  isHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";

import {
  KarPassportBridgeGatewayAbi,
} from "../lib/contracts/abis.generated.js";
import {
  createDeployerClients,
  createPublicClientForChain,
  hubRpcUrl,
  spokeRpcUrl,
  writeContractLocal,
  type DeployerClients,
} from "./lib/deployer-viem.js";
import {
  EID_HUB,
  EID_SPOKE,
  loadLayerZeroMetadataSnapshot,
  type LayerZeroEvmChainSnapshot,
  type LayerZeroMetadataSnapshot,
} from "./lib/layerzero-metadata.js";
import {
  addressToBytes32,
  assertLibrariesPinned,
  assertNoDeadDvnInRequired,
  assertReciprocalPeers,
  assertRequiredDvnCount,
  buildAppliedPathwayConfig,
  buildEnforcedOptions,
  buildExecutorConfig,
  buildReceiveLibSetConfigParams,
  buildSendLibSetConfigParams,
  buildUlnConfig,
  CONFIG_TYPE_EXECUTOR,
  CONFIG_TYPE_ULN,
  encodeExecutorConfig,
  encodeUlnConfig,
  hashAppliedPathwayConfig,
  requireEvmChain,
  requiredDvnsForPathway,
  ulnConfirmationsForDirection,
  type PathwayPeers,
  type UlnConfig,
} from "./lib/layerzero-pathway.js";
import {
  commercialDeploymentPath,
  loadCommercialDeployment,
  loadSpokeDeployment,
  requireSepoliaDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  SPOKE_CHAIN_ID,
  SPOKE_DEPLOYMENT_PATH,
  type SpokePathwayPeers,
} from "./lib/load-deployment.js";
import {
  writeDeploymentManifest,
  writeSpokeDeploymentManifest,
} from "./lib/write-deployment.js";

loadEnv({ path: ".env.local" });
loadEnv();

const require = createRequire(import.meta.url);

function loadEndpointAbi(): Abi {
  const json = require(
    "@layerzerolabs/lz-evm-protocol-v2/artifacts/contracts/interfaces/IMessageLibManager.sol/IMessageLibManager.json",
  ) as { abi: Abi };
  // Endpoint also exposes delegates(address) — merge minimal view.
  const delegatesAbi = [
    {
      type: "function",
      name: "delegates",
      stateMutability: "view",
      inputs: [{ name: "oapp", type: "address" }],
      outputs: [{ name: "", type: "address" }],
    },
  ] as const;
  return [...json.abi, ...delegatesAbi] as Abi;
}

const ENDPOINT_ABI = loadEndpointAbi();

type WireFlags = {
  readOnly: boolean;
  hub: boolean;
  spoke: boolean;
  allowMetadataDrift: boolean;
};

function parseFlags(argv: string[]): WireFlags {
  const readOnly = argv.includes("--read-only");
  const hubOnly = argv.includes("--hub");
  const spokeOnly = argv.includes("--spoke");
  if (hubOnly && spokeOnly) {
    throw new Error("Pass at most one of --hub / --spoke (default: both)");
  }
  return {
    readOnly,
    hub: hubOnly || (!hubOnly && !spokeOnly),
    spoke: spokeOnly || (!hubOnly && !spokeOnly),
    allowMetadataDrift: argv.includes("--allow-metadata-drift"),
  };
}

type SideClients =
  | { kind: "read"; public: PublicClient }
  | { kind: "write"; deployer: DeployerClients };

function makeClients(
  chain: typeof baseSepolia | typeof sepolia,
  rpcUrl: string,
  readOnly: boolean,
): SideClients {
  if (readOnly) {
    return { kind: "read", public: createPublicClientForChain(chain, rpcUrl) };
  }
  return { kind: "write", deployer: createDeployerClients(chain, rpcUrl) };
}

function sidePublic(clients: SideClients): PublicClient {
  return clients.kind === "read" ? clients.public : clients.deployer.public;
}

type SideContext = {
  label: string;
  localEid: number;
  remoteEid: number;
  localChainId: 84532 | 11155111;
  oapp: Address;
  remoteOApp: Address;
  chainSnap: LayerZeroEvmChainSnapshot;
  remoteSnap: LayerZeroEvmChainSnapshot;
  clients: SideClients;
  oappAbi: typeof KarPassportBridgeGatewayAbi;
};

type ActionResult = { action: string; status: "skip" | "write" | "read" | "refuse"; detail: string };

function decodeUlnConfig(config: Hex): UlnConfig {
  const [decoded] = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "confirmations", type: "uint64" },
          { name: "requiredDVNCount", type: "uint8" },
          { name: "optionalDVNCount", type: "uint8" },
          { name: "optionalDVNThreshold", type: "uint8" },
          { name: "requiredDVNs", type: "address[]" },
          { name: "optionalDVNs", type: "address[]" },
        ],
      },
    ],
    config,
  );
  return {
    confirmations: decoded.confirmations,
    requiredDVNCount: Number(decoded.requiredDVNCount),
    optionalDVNCount: Number(decoded.optionalDVNCount),
    optionalDVNThreshold: Number(decoded.optionalDVNThreshold),
    requiredDVNs: decoded.requiredDVNs.map((a) => getAddress(a)),
    optionalDVNs: decoded.optionalDVNs.map((a) => getAddress(a)),
  };
}

async function writeContract(
  side: SideContext,
  params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  },
): Promise<Hex> {
  if (side.clients.kind !== "write") {
    throw new Error("Wallet required for writes (omit --read-only)");
  }
  const { hash } = await writeContractLocal(side.clients.deployer, params);
  return hash;
}

async function wireSide(
  side: SideContext,
  snapshot: LayerZeroMetadataSnapshot,
  readOnly: boolean,
  errors: string[],
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const pc = sidePublic(side.clients);
  const endpoint = getAddress(side.chainSnap.endpointV2);
  const remoteEid = side.remoteEid;
  const expectedPeer = addressToBytes32(side.remoteOApp);

  const confirmations = ulnConfirmationsForDirection(
    snapshot,
    side.localEid,
    remoteEid,
  );
  const requiredDVNs = requiredDvnsForPathway(
    snapshot,
    side.localEid,
    remoteEid,
  );
  const uln = buildUlnConfig({ confirmations, requiredDVNs });
  const executor = buildExecutorConfig(side.chainSnap.executor);
  const enforced = buildEnforcedOptions(remoteEid);

  // --- peer ---
  const currentPeer = (await pc.readContract({
    address: side.oapp,
    abi: side.oappAbi,
    functionName: "peers",
    args: [remoteEid],
  })) as Hex;
  if (side.remoteOApp === zeroAddress) {
    results.push({
      action: "setPeer",
      status: "read",
      detail: "remote OApp unknown (spoke/hub manifest missing)",
    });
    errors.push(`${side.label}: remote OApp address unavailable — cannot assert peer`);
  } else if (currentPeer.toLowerCase() === expectedPeer.toLowerCase()) {
    results.push({ action: "setPeer", status: "skip", detail: `already ${side.remoteOApp}` });
  } else if (readOnly) {
    results.push({
      action: "setPeer",
      status: "read",
      detail: `mismatch: on-chain=${currentPeer} expected=${expectedPeer}`,
    });
    errors.push(
      `${side.label}: peer for eid ${remoteEid} not set (got ${currentPeer})`,
    );
  } else {
    await writeContract(side, {
      address: side.oapp,
      abi: side.oappAbi as Abi,
      functionName: "setPeer",
      args: [remoteEid, expectedPeer],
    });
    const after = (await pc.readContract({
      address: side.oapp,
      abi: side.oappAbi,
      functionName: "peers",
      args: [remoteEid],
    })) as Hex;
    if (after.toLowerCase() !== expectedPeer.toLowerCase()) {
      errors.push(`${side.label}: setPeer read-back failed`);
    }
    results.push({ action: "setPeer", status: "write", detail: `→ ${side.remoteOApp}` });
  }

  // --- send library ---
  const sendLib = getAddress(
    (await pc.readContract({
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "getSendLibrary",
      args: [side.oapp, remoteEid],
    })) as Address,
  );
  const isDefaultSend = (await pc.readContract({
    address: endpoint,
    abi: ENDPOINT_ABI,
    functionName: "isDefaultSendLibrary",
    args: [side.oapp, remoteEid],
  })) as boolean;
  const targetSend = getAddress(side.chainSnap.sendUln302);

  if (!isDefaultSend && sendLib === targetSend) {
    results.push({ action: "setSendLibrary", status: "skip", detail: sendLib });
  } else if (readOnly) {
    results.push({
      action: "setSendLibrary",
      status: "read",
      detail: `lib=${sendLib} default=${isDefaultSend} target=${targetSend}`,
    });
  } else if (sendLib === targetSend && !isDefaultSend) {
    results.push({ action: "setSendLibrary", status: "skip", detail: sendLib });
  } else {
    await writeContract(side, {
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "setSendLibrary",
      args: [side.oapp, remoteEid, targetSend],
    });
    results.push({ action: "setSendLibrary", status: "write", detail: `→ ${targetSend}` });
  }

  // --- receive library ---
  const [recvLibRaw, isDefaultRecv] = (await pc.readContract({
    address: endpoint,
    abi: ENDPOINT_ABI,
    functionName: "getReceiveLibrary",
    args: [side.oapp, remoteEid],
  })) as [Address, boolean];
  const recvLib = getAddress(recvLibRaw);
  const targetRecv = getAddress(side.chainSnap.receiveUln302);

  if (!isDefaultRecv && recvLib === targetRecv) {
    results.push({ action: "setReceiveLibrary", status: "skip", detail: recvLib });
  } else if (!isDefaultRecv && recvLib !== targetRecv && recvLib !== zeroAddress) {
    const msg =
      `${side.label}: refuse to CHANGE receive library from ${recvLib} to ${targetRecv}. ` +
      `Use explicit setReceiveLibraryTimeout procedure (SPEC §7.6; out of scope for bridge-wire).`;
    results.push({ action: "setReceiveLibrary", status: "refuse", detail: msg });
    errors.push(msg);
  } else if (readOnly) {
    results.push({
      action: "setReceiveLibrary",
      status: "read",
      detail: `lib=${recvLib} default=${isDefaultRecv} target=${targetRecv}`,
    });
  } else {
    await writeContract(side, {
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "setReceiveLibrary",
      args: [side.oapp, remoteEid, targetRecv, 0n],
    });
    results.push({ action: "setReceiveLibrary", status: "write", detail: `→ ${targetRecv}` });
  }

  // Re-read libraries after potential writes for asserts
  const sendLibFinal = getAddress(
    (await pc.readContract({
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "getSendLibrary",
      args: [side.oapp, remoteEid],
    })) as Address,
  );
  const isDefaultSendFinal = (await pc.readContract({
    address: endpoint,
    abi: ENDPOINT_ABI,
    functionName: "isDefaultSendLibrary",
    args: [side.oapp, remoteEid],
  })) as boolean;
  const [recvLibFinalRaw, isDefaultRecvFinal] = (await pc.readContract({
    address: endpoint,
    abi: ENDPOINT_ABI,
    functionName: "getReceiveLibrary",
    args: [side.oapp, remoteEid],
  })) as [Address, boolean];
  const recvLibFinal = getAddress(recvLibFinalRaw);

  errors.push(
    ...assertLibrariesPinned(side.chainSnap, {
      sendLibrary: sendLibFinal,
      receiveLibrary: recvLibFinal,
      isDefaultSend: isDefaultSendFinal,
      isDefaultReceive: isDefaultRecvFinal,
    }).map((e) => `${side.label}: ${e}`),
  );

  // --- setConfig send lib (ULN + Executor) ---
  const sendParams = buildSendLibSetConfigParams(remoteEid, uln, executor);
  const expectedSendUln = encodeUlnConfig(uln);
  const expectedExec = encodeExecutorConfig(executor);

  let sendUlnMatches = false;
  let execMatches = false;
  try {
    const onchainUln = (await pc.readContract({
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "getConfig",
      args: [side.oapp, targetSend, remoteEid, CONFIG_TYPE_ULN],
    })) as Hex;
    const onchainExec = (await pc.readContract({
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "getConfig",
      args: [side.oapp, targetSend, remoteEid, CONFIG_TYPE_EXECUTOR],
    })) as Hex;
    sendUlnMatches = onchainUln.toLowerCase() === expectedSendUln.toLowerCase();
    execMatches = onchainExec.toLowerCase() === expectedExec.toLowerCase();
  } catch {
    sendUlnMatches = false;
    execMatches = false;
  }

  if (sendUlnMatches && execMatches) {
    results.push({ action: "setConfig(send)", status: "skip", detail: "ULN+Executor match" });
  } else if (readOnly) {
    results.push({
      action: "setConfig(send)",
      status: "read",
      detail: `ulnMatch=${sendUlnMatches} execMatch=${execMatches}`,
    });
    if (!sendUlnMatches || !execMatches) {
      errors.push(`${side.label}: send-lib ULN/Executor config not pinned to snapshot`);
    }
  } else {
    await writeContract(side, {
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "setConfig",
      args: [side.oapp, targetSend, sendParams],
    });
    results.push({ action: "setConfig(send)", status: "write", detail: "ULN+Executor" });
  }

  // --- setConfig receive lib (ULN) ---
  const recvParams = buildReceiveLibSetConfigParams(remoteEid, uln);
  let recvUlnMatches = false;
  try {
    const onchainRecvUln = (await pc.readContract({
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "getConfig",
      args: [side.oapp, targetRecv, remoteEid, CONFIG_TYPE_ULN],
    })) as Hex;
    recvUlnMatches = onchainRecvUln.toLowerCase() === expectedSendUln.toLowerCase();
  } catch {
    recvUlnMatches = false;
  }

  if (recvUlnMatches) {
    results.push({ action: "setConfig(receive)", status: "skip", detail: "ULN match" });
  } else if (readOnly) {
    results.push({
      action: "setConfig(receive)",
      status: "read",
      detail: `ulnMatch=${recvUlnMatches}`,
    });
    if (!recvUlnMatches) {
      errors.push(`${side.label}: receive-lib ULN config not pinned to snapshot`);
    }
  } else {
    await writeContract(side, {
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "setConfig",
      args: [side.oapp, targetRecv, recvParams],
    });
    results.push({ action: "setConfig(receive)", status: "write", detail: "ULN" });
  }

  // Read-back ULN for §7.6 DVN asserts (best-effort after write / on read)
  try {
    const onchainUlnHex = (await pc.readContract({
      address: endpoint,
      abi: ENDPOINT_ABI,
      functionName: "getConfig",
      args: [side.oapp, targetSend, remoteEid, CONFIG_TYPE_ULN],
    })) as Hex;
    if (isHex(onchainUlnHex) && onchainUlnHex !== "0x") {
      const decoded = decodeUlnConfig(onchainUlnHex);
      errors.push(
        ...assertRequiredDvnCount(decoded.requiredDVNCount).map(
          (e) => `${side.label}: ${e}`,
        ),
      );
      errors.push(
        ...assertNoDeadDvnInRequired(decoded.requiredDVNs, side.chainSnap.deadDvn).map(
          (e) => `${side.label}: ${e}`,
        ),
      );
    }
  } catch {
    if (readOnly) {
      errors.push(`${side.label}: unable to read send ULN config for DVN asserts`);
    }
  }

  // --- enforced options ---
  for (const param of enforced) {
    const current = (await pc.readContract({
      address: side.oapp,
      abi: side.oappAbi,
      functionName: "enforcedOptions",
      args: [param.eid, param.msgType],
    })) as Hex;
    if (current.toLowerCase() === param.options.toLowerCase()) {
      results.push({
        action: `setEnforcedOptions(msgType=${param.msgType})`,
        status: "skip",
        detail: current,
      });
    } else if (readOnly) {
      results.push({
        action: `setEnforcedOptions(msgType=${param.msgType})`,
        status: "read",
        detail: `on-chain=${current || "(empty)"} expected=${param.options}`,
      });
      errors.push(
        `${side.label}: enforcedOptions msgType ${param.msgType} not set`,
      );
    } else {
      // set both in one call when any differs — handled below
    }
  }

  const needEnforcedWrite =
    !readOnly &&
    (
      await Promise.all(
        enforced.map(async (param) => {
          const current = (await pc.readContract({
            address: side.oapp,
            abi: side.oappAbi,
            functionName: "enforcedOptions",
            args: [param.eid, param.msgType],
          })) as Hex;
          return current.toLowerCase() !== param.options.toLowerCase();
        }),
      )
    ).some(Boolean);

  if (needEnforcedWrite) {
    await writeContract(side, {
      address: side.oapp,
      abi: side.oappAbi as Abi,
      functionName: "setEnforcedOptions",
      args: [enforced],
    });
    for (const param of enforced) {
      const after = (await pc.readContract({
        address: side.oapp,
        abi: side.oappAbi,
        functionName: "enforcedOptions",
        args: [param.eid, param.msgType],
      })) as Hex;
      if (after.toLowerCase() !== param.options.toLowerCase()) {
        errors.push(
          `${side.label}: setEnforcedOptions msgType ${param.msgType} read-back failed`,
        );
      }
      results.push({
        action: `setEnforcedOptions(msgType=${param.msgType})`,
        status: "write",
        detail: param.options,
      });
    }
  }

  return results;
}

function printTable(
  snapshot: LayerZeroMetadataSnapshot,
  sides: { side: SideContext; results: ActionResult[] }[],
  errors: string[],
): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Bridge pathway config ===");
  for (const { side, results } of sides) {
    lines.push("");
    lines.push(
      `${side.label}  localEid=${side.localEid}  oapp=${side.oapp}  remoteEid=${side.remoteEid}  remote=${side.remoteOApp}`,
    );
    lines.push(
      `  sendUln302=${side.chainSnap.sendUln302}  receiveUln302=${side.chainSnap.receiveUln302}  executor=${side.chainSnap.executor}`,
    );
    lines.push(
      `  requiredDVNs=${requiredDvnsForPathway(snapshot, side.localEid, side.remoteEid).join(",")}`,
    );
    for (const r of results) {
      lines.push(`  [${r.status}] ${r.action}: ${r.detail}`);
    }
  }
  lines.push("");
  if (errors.length === 0) {
    lines.push("§7.6 asserts: PASS");
  } else {
    lines.push(`§7.6 asserts: FAIL (${errors.length})`);
    for (const e of errors) {
      lines.push(`  - ${e}`);
    }
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const snapshot = loadLayerZeroMetadataSnapshot({
    allowDrift: flags.allowMetadataDrift,
  });

  const allErrors: string[] = [];

  let hubOApp: Address | null = null;
  let spokeOApp: Address | null = null;

  try {
    const hubManifest = requireSepoliaDeployment();
    if (!hubManifest.bridgeGateway) {
      throw new Error(`bridgeGateway missing in ${SEPOLIA_DEPLOYMENT_PATH}`);
    }
    hubOApp = getAddress(hubManifest.bridgeGateway);
  } catch (err) {
    if (flags.hub) {
      throw err instanceof Error
        ? err
        : new Error(`Missing hub manifest ${SEPOLIA_DEPLOYMENT_PATH}`);
    }
  }

  {
    const ethCommercial = loadCommercialDeployment(SPOKE_CHAIN_ID);
    if (ethCommercial?.bridgeGateway) {
      spokeOApp = getAddress(ethCommercial.bridgeGateway);
    } else {
      const legacySpoke = loadSpokeDeployment();
      if (legacySpoke?.karPassportOnft) {
        spokeOApp = getAddress(legacySpoke.karPassportOnft);
      }
    }
  }

  if (!spokeOApp && flags.spoke && flags.readOnly) {
    process.stderr.write(
      `Note: eth OApp missing in ${SPOKE_DEPLOYMENT_PATH} (nuclear commercial gateway or legacy thin ONFT). Continuing hub-only read-only.\n`,
    );
    flags.spoke = false;
    if (!flags.hub) {
      throw new Error(`Nothing to check — eth OApp missing and --hub not selected`);
    }
  }

  if (flags.hub && !hubOApp) {
    throw new Error(
      `Hub OApp required — nuclear commercial deploy (or hub gateway) and ensure ${SEPOLIA_DEPLOYMENT_PATH}`,
    );
  }
  if (flags.spoke && !spokeOApp) {
    throw new Error(
      `Eth OApp required — run nuclear deploy for 11155111 (commercial bridgeGateway)`,
    );
  }

  const effectiveSpoke = spokeOApp ?? zeroAddress;
  const effectiveHub = hubOApp ?? zeroAddress;

  const peers: PathwayPeers = {
    hubEid: EID_HUB,
    spokeEid: EID_SPOKE,
    hubOApp: effectiveHub,
    spokeOApp: effectiveSpoke,
  };
  if (hubOApp && spokeOApp) {
    allErrors.push(...assertReciprocalPeers(peers));
  }

  const sideRuns: { side: SideContext; results: ActionResult[] }[] = [];

  if (flags.hub && hubOApp) {
    const side: SideContext = {
      label: "HUB Base Sepolia",
      localEid: EID_HUB,
      remoteEid: EID_SPOKE,
      localChainId: SEPOLIA_CHAIN_ID,
      oapp: hubOApp,
      remoteOApp: effectiveSpoke,
      chainSnap: requireEvmChain(snapshot, EID_HUB),
      remoteSnap: requireEvmChain(snapshot, EID_SPOKE),
      clients: makeClients(baseSepolia, hubRpcUrl(), flags.readOnly),
      oappAbi: KarPassportBridgeGatewayAbi,
    };
    const results = await wireSide(side, snapshot, flags.readOnly, allErrors);
    sideRuns.push({ side, results });
  }

  if (flags.spoke && spokeOApp) {
    const side: SideContext = {
      label: "SPOKE Ethereum Sepolia",
      localEid: EID_SPOKE,
      remoteEid: EID_HUB,
      localChainId: SPOKE_CHAIN_ID,
      oapp: spokeOApp,
      remoteOApp: effectiveHub,
      chainSnap: requireEvmChain(snapshot, EID_SPOKE),
      remoteSnap: requireEvmChain(snapshot, EID_HUB),
      clients: makeClients(sepolia, spokeRpcUrl(), flags.readOnly),
      oappAbi: KarPassportBridgeGatewayAbi,
    };
    const results = await wireSide(side, snapshot, flags.readOnly, allErrors);
    sideRuns.push({ side, results });
  }

  printTable(snapshot, sideRuns, allErrors);

  const fullWireSuccess =
    !flags.readOnly &&
    flags.hub &&
    flags.spoke &&
    hubOApp !== null &&
    spokeOApp !== null &&
    allErrors.length === 0;

  if (fullWireSuccess) {
    const applied = buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: EID_SPOKE,
      hubOApp,
      spokeOApp,
    });
    const pathwayConfigHash = hashAppliedPathwayConfig(applied);
    const peersBook: SpokePathwayPeers = {
      hubEid: EID_HUB,
      spokeEid: EID_SPOKE,
      hubOApp,
      spokeOApp,
    };

    const ethCommercial = loadCommercialDeployment(SPOKE_CHAIN_ID);
    if (ethCommercial) {
      writeDeploymentManifest(commercialDeploymentPath(SPOKE_CHAIN_ID), {
        ...ethCommercial,
        peers: peersBook,
        pathwayConfigHash,
      });
      process.stdout.write(
        `Updated ${commercialDeploymentPath(SPOKE_CHAIN_ID)} peers + pathwayConfigHash=${pathwayConfigHash}\n`,
      );
    }

    const legacySpoke = loadSpokeDeployment();
    if (legacySpoke) {
      writeSpokeDeploymentManifest(SPOKE_DEPLOYMENT_PATH, {
        ...legacySpoke,
        peers: peersBook,
        pathwayConfigHash,
      });
      process.stdout.write(
        `Updated ${SPOKE_DEPLOYMENT_PATH} (legacy thin ONFT) peers + pathwayConfigHash=${pathwayConfigHash}\n`,
      );
    }
  }

  if (allErrors.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
