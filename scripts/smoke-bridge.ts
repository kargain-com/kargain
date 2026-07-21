/**
 * Live bridge E2E smoke — hub (84532 / EID 40245) ↔ eth (11155111 / EID 40161).
 *
 * Nuclear dual commercial stacks: both sides are KarPassport + gateway
 * (`bridgeGateway`). Legacy thin-ONFT eth manifest still resolves for OApp.
 *
 * Usage:
 *   pnpm smoke:bridge
 *   pnpm smoke:bridge --token-id <id>
 *   pnpm smoke:bridge --skip-return
 *
 * Delivery gate: dest-chain RPC ownership (not LZ Scan). GUID from ONFTSent
 * receipt log; Scan status is best-effort for the summary table only.
 */
import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { getAddress, type Address, type Hex } from "viem";

import {
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
} from "../lib/contracts/abis.generated.js";
import {
  createHubDeployerClients,
  createSpokeDeployerClients,
  writeContractLocal,
  type DeployerClients,
} from "./lib/deployer-viem.js";
import {
  loadCommercialDeployment,
  loadSpokeDeployment,
  requireSepoliaDeployment,
  SPOKE_CHAIN_ID,
} from "./lib/load-deployment.js";
import {
  addressToBytes32,
  buildEnforcedOptions,
  MSG_TYPE_SEND,
  MSG_TYPE_SEND_AND_COMPOSE,
} from "./lib/layerzero-pathway.js";
import { EID_HUB, EID_SPOKE } from "./lib/layerzero-metadata.js";
import { onftSentGuidFromLogs } from "./lib/onft-sent.js";

loadEnv({ path: ".env.local" });
loadEnv();

const DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;
const DELIVERY_POLL_MS = 8_000;
const SCAN_TESTNET_BASE = "https://scan-testnet.layerzero-api.com/v1";
const NUCLEAR_SMOKE_URI = "ar://nuclear-smoke";

type MessagingFee = { nativeFee: bigint; lzTokenFee: bigint };

type SmokeFlags = {
  tokenId: bigint | null;
  skipReturn: boolean;
};

type StepResult = { step: string; ok: boolean; detail: string };

type LegSummary = {
  label: string;
  txHash: Hex | null;
  guid: Hex | null;
  feeWei: bigint | null;
  scanStatus: string | null;
};

type ResolvedBridge = {
  hubGateway: Address;
  hubPassport: Address;
  ethGateway: Address;
  ethPassport: Address;
  /** True when eth side is nuclear commercial KarPassport+gateway (not thin ONFT). */
  ethCommercial: boolean;
};

function fail(msg: string): never {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}

function pass(step: string, detail: string): void {
  console.log(`PASS  (${step}) ${detail}`);
}

function parseFlags(argv: string[]): SmokeFlags {
  let tokenIdRaw: string | null = null;
  let skipReturn = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-return") {
      skipReturn = true;
      continue;
    }
    if (arg === "--token-id") {
      tokenIdRaw = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--token-id=")) {
      tokenIdRaw = arg.slice("--token-id=".length);
      continue;
    }
  }
  if (tokenIdRaw == null || tokenIdRaw === "") {
    return { tokenId: null, skipReturn };
  }
  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdRaw);
  } catch {
    fail(`Invalid --token-id: ${tokenIdRaw}`);
  }
  if (tokenId < 0n) fail(`--token-id must be non-negative (got ${tokenId})`);
  return { tokenId, skipReturn };
}

function resolveBridgeAddresses(): ResolvedBridge {
  const hubManifest = requireSepoliaDeployment();
  if (!hubManifest.bridgeGateway) {
    fail(`bridgeGateway missing in deployments/84532.json`);
  }

  const ethCommercial = loadCommercialDeployment(SPOKE_CHAIN_ID);
  if (ethCommercial?.bridgeGateway && ethCommercial.karPassport) {
    return {
      hubGateway: getAddress(hubManifest.bridgeGateway),
      hubPassport: getAddress(hubManifest.karPassport),
      ethGateway: getAddress(ethCommercial.bridgeGateway),
      ethPassport: getAddress(ethCommercial.karPassport),
      ethCommercial: true,
    };
  }

  const legacySpoke = loadSpokeDeployment();
  if (legacySpoke?.karPassportOnft) {
    const onft = getAddress(legacySpoke.karPassportOnft);
    return {
      hubGateway: getAddress(hubManifest.bridgeGateway),
      hubPassport: getAddress(hubManifest.karPassport),
      ethGateway: onft,
      ethPassport: onft,
      ethCommercial: false,
    };
  }

  fail(
    `Eth OApp missing in deployments/11155111.json — run nuclear deploy (commercial bridgeGateway) or legacy pnpm deploy:spoke:sepolia`,
  );
}

function optionsFor(
  msgType: typeof MSG_TYPE_SEND | typeof MSG_TYPE_SEND_AND_COMPOSE,
  remoteEid: number,
): Hex {
  const params = buildEnforcedOptions(remoteEid);
  const match = params.find((p) => p.msgType === msgType);
  if (!match) {
    throw new Error(`No enforcedOptions for msgType ${msgType} remoteEid ${remoteEid}`);
  }
  return match.options;
}

function sendParam(dstEid: number, to: Address, tokenId: bigint, extraOptions: Hex) {
  return {
    dstEid,
    to: addressToBytes32(to),
    tokenId,
    extraOptions,
    composeMsg: "0x" as Hex,
    onftCmd: "0x" as Hex,
  };
}

async function quoteAndSend(params: {
  clients: DeployerClients;
  oapp: Address;
  abi: typeof KarPassportBridgeGatewayAbi;
  send: ReturnType<typeof sendParam>;
}): Promise<{ hash: Hex; guid: Hex; fee: MessagingFee }> {
  const fee = (await params.clients.public.readContract({
    address: params.oapp,
    abi: params.abi,
    functionName: "quoteSend",
    args: [params.send, false],
  })) as MessagingFee;

  const refund = getAddress(params.clients.account.address);
  const { hash, receipt } = await writeContractLocal(params.clients, {
    address: params.oapp,
    abi: params.abi,
    functionName: "send",
    args: [params.send, fee, refund],
    value: fee.nativeFee,
  });

  return {
    hash,
    guid: onftSentGuidFromLogs(params.abi, receipt.logs),
    fee,
  };
}

async function pollUntil(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      if (await predicate()) {
        console.log(`  … ${label}: delivered (attempt ${attempt})`);
        return;
      }
    } catch {
      // RPC transient / token not yet minted
    }
    const remaining = Math.max(0, deadline - Date.now());
    console.log(
      `  … ${label}: waiting (${attempt}, ${Math.ceil(remaining / 1000)}s left)`,
    );
    await new Promise((r) => setTimeout(r, DELIVERY_POLL_MS));
  }
  fail(`${label}: delivery timeout after ${timeoutMs / 1000}s`);
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

function runWireReadOnly(): void {
  console.log("(0) bridge:wire:read-only …");
  const result = spawnSync("pnpm", ["bridge:wire:read-only"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    fail(`(0) bridge:wire:read-only exited ${result.status ?? "signal"}`);
  }
  pass("0", "bridge:wire:read-only green");
}

function printSummary(legs: LegSummary[], steps: StepResult[]): void {
  console.log("");
  console.log("=== smoke:bridge summary ===");
  for (const leg of legs) {
    console.log(`  ${leg.label}`);
    console.log(`    tx:   ${leg.txHash ?? "—"}`);
    console.log(`    guid: ${leg.guid ?? "—"}`);
    console.log(
      `    fee:  ${leg.feeWei != null ? `${leg.feeWei.toString()} wei` : "—"}`,
    );
    console.log(`    scan: ${leg.scanStatus ?? "—"}`);
  }
  console.log("");
  const failed = steps.filter((s) => !s.ok);
  if (failed.length === 0) {
    console.log(`Result: PASS (${steps.length} steps)`);
  } else {
    console.log(`Result: FAIL (${failed.length}/${steps.length})`);
    for (const f of failed) {
      console.log(`  - (${f.step}) ${f.detail}`);
    }
  }
  console.log("");
}

async function readOwnerOf(
  clients: DeployerClients,
  nft: Address,
  tokenId: bigint,
  commercial: boolean,
): Promise<Address> {
  return getAddress(
    (await clients.public.readContract({
      address: nft,
      abi: commercial ? KarPassportAbi : KarPassportBridgeGatewayAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Address,
  );
}

async function readTokenUri(
  clients: DeployerClients,
  nft: Address,
  tokenId: bigint,
  commercial: boolean,
): Promise<string> {
  return (await clients.public.readContract({
    address: nft,
    abi: commercial ? KarPassportAbi : KarPassportBridgeGatewayAbi,
    functionName: "tokenURI",
    args: [tokenId],
  })) as string;
}

async function ensureApprovalForAll(
  clients: DeployerClients,
  passport: Address,
  gateway: Address,
  owner: Address,
): Promise<void> {
  const approved = (await clients.public.readContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "isApprovedForAll",
    args: [owner, gateway],
  })) as boolean;
  if (approved) return;
  await writeContractLocal(clients, {
    address: passport,
    abi: KarPassportAbi,
    functionName: "setApprovalForAll",
    args: [gateway, true],
  });
  console.log(`  approved gateway ${gateway} on ${passport}`);
}

async function mintSmokePassport(
  hub: DeployerClients,
  hubPassport: Address,
  to: Address,
): Promise<bigint> {
  const tokenId = (await hub.public.readContract({
    address: hubPassport,
    abi: KarPassportAbi,
    functionName: "nextTokenId",
  })) as bigint;
  await writeContractLocal(hub, {
    address: hubPassport,
    abi: KarPassportAbi,
    functionName: "mintPassport",
    args: [to, NUCLEAR_SMOKE_URI],
  });
  console.log(`  minted passport tokenId=${tokenId} uri=${NUCLEAR_SMOKE_URI}`);
  return tokenId;
}

/**
 * Resolve a deployer-owned hub passport: use --token-id when owned;
 * otherwise mint (also when --token-id omitted or token missing / not owned).
 */
async function resolveTokenId(params: {
  hub: DeployerClients;
  hubPassport: Address;
  hubGateway: Address;
  accountAddress: Address;
  requested: bigint | null;
}): Promise<bigint> {
  const { hub, hubPassport, hubGateway, accountAddress, requested } = params;

  if (requested != null) {
    try {
      const owner = await readOwnerOf(hub, hubPassport, requested, true);
      if (owner === accountAddress) {
        await ensureApprovalForAll(hub, hubPassport, hubGateway, accountAddress);
        return requested;
      }
      console.log(
        `  token ${requested} owned by ${owner} ≠ deployer; minting new passport`,
      );
    } catch {
      console.log(`  token ${requested} missing on hub; minting new passport`);
    }
  }

  const tokenId = await mintSmokePassport(hub, hubPassport, accountAddress);
  await ensureApprovalForAll(hub, hubPassport, hubGateway, accountAddress);
  return tokenId;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const steps: StepResult[] = [];
  const legs: LegSummary[] = [];

  const bridge = resolveBridgeAddresses();
  const hub = createHubDeployerClients();
  const spoke = createSpokeDeployerClients();
  const accountAddress = getAddress(hub.account.address);

  console.log("Kargain bridge smoke");
  console.log(
    `  tokenId:   ${flags.tokenId != null ? flags.tokenId.toString() : "(mint if needed)"}`,
  );
  console.log(`  recipient: ${accountAddress} (deployer)`);
  console.log(`  hub gw:    ${bridge.hubGateway}`);
  console.log(`  hub nft:   ${bridge.hubPassport}`);
  console.log(`  eth gw:    ${bridge.ethGateway}`);
  console.log(`  eth nft:   ${bridge.ethPassport}`);
  console.log(`  eth mode:  ${bridge.ethCommercial ? "nuclear commercial" : "legacy thin ONFT"}`);
  console.log(`  skipReturn:${flags.skipReturn}`);
  console.log("");

  try {
    runWireReadOnly();
    steps.push({ step: "0", ok: true, detail: "wire read-only" });
  } catch (err) {
    steps.push({
      step: "0",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    printSummary(legs, steps);
    process.exit(1);
  }

  const tokenId = await resolveTokenId({
    hub,
    hubPassport: bridge.hubPassport,
    hubGateway: bridge.hubGateway,
    accountAddress,
    requested: flags.tokenId,
  });
  console.log(`  using tokenId=${tokenId}`);
  console.log("");

  const originalOwner = await readOwnerOf(hub, bridge.hubPassport, tokenId, true);
  if (originalOwner !== accountAddress) {
    fail(
      `Preflight: token ${tokenId} owner ${originalOwner} ≠ deployer ${accountAddress}`,
    );
  }

  const statusBefore = Number(
    await hub.public.readContract({
      address: bridge.hubPassport,
      abi: KarPassportAbi,
      functionName: "passportStatus",
      args: [tokenId],
    }),
  );
  const hubUriBefore = await readTokenUri(hub, bridge.hubPassport, tokenId, true);

  console.log(`  preflight: owner=${originalOwner} status=${statusBefore} uri=${hubUriBefore}`);
  console.log("");

  const hubSendParam = sendParam(
    EID_SPOKE,
    accountAddress,
    tokenId,
    optionsFor(MSG_TYPE_SEND_AND_COMPOSE, EID_SPOKE),
  );
  try {
    const hubFee = (await hub.public.readContract({
      address: bridge.hubGateway,
      abi: KarPassportBridgeGatewayAbi,
      functionName: "quoteSend",
      args: [hubSendParam, false],
    })) as MessagingFee;
    if (hubFee.nativeFee <= 0n) {
      fail(`(1) quoteSend nativeFee is ${hubFee.nativeFee} (expected > 0)`);
    }
    pass("1", `quoteSend hub→eth fee=${hubFee.nativeFee} wei`);
    steps.push({ step: "1", ok: true, detail: `fee=${hubFee.nativeFee}` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (1) ${detail}`);
    steps.push({ step: "1", ok: false, detail });
    printSummary(legs, steps);
    process.exit(1);
  }

  let hubLeg: LegSummary = {
    label: "hub→eth",
    txHash: null,
    guid: null,
    feeWei: null,
    scanStatus: null,
  };
  try {
    const sent = await quoteAndSend({
      clients: hub,
      oapp: bridge.hubGateway,
      abi: KarPassportBridgeGatewayAbi,
      send: hubSendParam,
    });
    hubLeg = {
      label: "hub→eth",
      txHash: sent.hash,
      guid: sent.guid,
      feeWei: sent.fee.nativeFee,
      scanStatus: null,
    };
    legs.push(hubLeg);
    console.log(`  send hub→eth tx=${sent.hash} guid=${sent.guid}`);

    await pollUntil(
      "eth ownerOf",
      async () => {
        const owner = await readOwnerOf(
          spoke,
          bridge.ethPassport,
          tokenId,
          bridge.ethCommercial,
        );
        return owner === accountAddress;
      },
      DELIVERY_TIMEOUT_MS,
    );
    hubLeg.scanStatus = await fetchScanStatus(sent.guid);
    pass("2", `delivered; scan=${hubLeg.scanStatus}`);
    steps.push({ step: "2", ok: true, detail: `tx=${sent.hash}` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (2) ${detail}`);
    steps.push({ step: "2", ok: false, detail });
    if (hubLeg.txHash && !legs.includes(hubLeg)) legs.push(hubLeg);
    printSummary(legs, steps);
    process.exit(1);
  }

  try {
    const ethOwner = await readOwnerOf(
      spoke,
      bridge.ethPassport,
      tokenId,
      bridge.ethCommercial,
    );
    const ethUri = await readTokenUri(
      spoke,
      bridge.ethPassport,
      tokenId,
      bridge.ethCommercial,
    );
    const hubOwner = await readOwnerOf(hub, bridge.hubPassport, tokenId, true);
    const statusAfter = Number(
      await hub.public.readContract({
        address: bridge.hubPassport,
        abi: KarPassportAbi,
        functionName: "passportStatus",
        args: [tokenId],
      }),
    );

    const errors: string[] = [];
    if (ethOwner !== accountAddress) {
      errors.push(`eth ownerOf ${ethOwner} ≠ recipient ${accountAddress}`);
    }
    if (ethUri !== hubUriBefore) {
      errors.push(`eth tokenURI mismatch (eth=${ethUri} hub=${hubUriBefore})`);
    }
    if (hubOwner !== bridge.hubGateway) {
      errors.push(`hub ownerOf ${hubOwner} ≠ gateway ${bridge.hubGateway}`);
    }
    if (statusAfter !== statusBefore) {
      errors.push(`passportStatus changed ${statusBefore} → ${statusAfter}`);
    }
    if (errors.length > 0) {
      fail(`(3) ${errors.join("; ")}`);
    }
    pass(
      "3",
      `eth owner+URI ok; hub locked in gateway; status=${statusAfter} unchanged`,
    );
    steps.push({ step: "3", ok: true, detail: "post hub→eth asserts" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (3) ${detail}`);
    steps.push({ step: "3", ok: false, detail });
    printSummary(legs, steps);
    process.exit(1);
  }

  if (flags.skipReturn) {
    console.log("");
    console.log("--skip-return: stopping after hub→eth");
    printSummary(legs, steps);
    return;
  }

  if (bridge.ethCommercial) {
    await ensureApprovalForAll(
      spoke,
      bridge.ethPassport,
      bridge.ethGateway,
      accountAddress,
    );
  }

  const returnParam = sendParam(
    EID_HUB,
    originalOwner,
    tokenId,
    optionsFor(MSG_TYPE_SEND, EID_HUB),
  );
  let returnLeg: LegSummary = {
    label: "eth→hub",
    txHash: null,
    guid: null,
    feeWei: null,
    scanStatus: null,
  };
  try {
    const returnFee = (await spoke.public.readContract({
      address: bridge.ethGateway,
      abi: KarPassportBridgeGatewayAbi,
      functionName: "quoteSend",
      args: [returnParam, false],
    })) as MessagingFee;
    if (returnFee.nativeFee <= 0n) {
      fail(`(4) return quoteSend nativeFee is ${returnFee.nativeFee}`);
    }

    const sent = await quoteAndSend({
      clients: spoke,
      oapp: bridge.ethGateway,
      abi: KarPassportBridgeGatewayAbi,
      send: returnParam,
    });
    returnLeg = {
      label: "eth→hub",
      txHash: sent.hash,
      guid: sent.guid,
      feeWei: sent.fee.nativeFee,
      scanStatus: null,
    };
    legs.push(returnLeg);
    console.log(`  send eth→hub tx=${sent.hash} guid=${sent.guid}`);

    await pollUntil(
      "hub ownerOf unlock",
      async () => {
        const owner = await readOwnerOf(hub, bridge.hubPassport, tokenId, true);
        return owner === originalOwner;
      },
      DELIVERY_TIMEOUT_MS,
    );
    returnLeg.scanStatus = await fetchScanStatus(sent.guid);
    pass("4", `returned; scan=${returnLeg.scanStatus}`);
    steps.push({ step: "4", ok: true, detail: `tx=${sent.hash}` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (4) ${detail}`);
    steps.push({ step: "4", ok: false, detail });
    if (returnLeg.txHash && !legs.includes(returnLeg)) legs.push(returnLeg);
    printSummary(legs, steps);
    process.exit(1);
  }

  try {
    const hubOwner = await readOwnerOf(hub, bridge.hubPassport, tokenId, true);
    const statusFinal = Number(
      await hub.public.readContract({
        address: bridge.hubPassport,
        abi: KarPassportAbi,
        functionName: "passportStatus",
        args: [tokenId],
      }),
    );

    let ethBurned = false;
    try {
      await readOwnerOf(spoke, bridge.ethPassport, tokenId, bridge.ethCommercial);
    } catch {
      ethBurned = true;
    }

    const errors: string[] = [];
    if (hubOwner !== originalOwner) {
      errors.push(`hub ownerOf ${hubOwner} ≠ original ${originalOwner}`);
    }
    if (!ethBurned) {
      errors.push("eth ownerOf still succeeds (expected burn / revert)");
    }
    if (statusFinal !== statusBefore) {
      errors.push(`passportStatus changed ${statusBefore} → ${statusFinal}`);
    }
    if (errors.length > 0) {
      fail(`(5) ${errors.join("; ")}`);
    }
    pass("5", `hub unlocked to owner; eth burned; status=${statusFinal} unchanged`);
    steps.push({ step: "5", ok: true, detail: "post return asserts" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (5) ${detail}`);
    steps.push({ step: "5", ok: false, detail });
    printSummary(legs, steps);
    process.exit(1);
  }

  printSummary(legs, steps);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
