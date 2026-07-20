/**
 * Live bridge E2E smoke — hub (84532 / EID 40245) ↔ spoke (11155111 / EID 40161).
 *
 * Usage:
 *   pnpm smoke:bridge --token-id <id>
 *   pnpm smoke:bridge --token-id <id> --skip-return
 *
 * Delivery gate: dest-chain RPC ownership (not LZ Scan). GUID from send receipt;
 * Scan status is best-effort for the summary table only.
 *
 * No Cursor live txs — user runs this after wire is green.
 */
import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";

import {
  KarPassportAbi,
  KarPassportONFT721Abi,
  ProxyONFT721AdapterAbi,
} from "../lib/contracts/abis.generated.js";
import {
  requireSepoliaDeployment,
  requireSpokeDeployment,
} from "./lib/load-deployment.js";
import {
  addressToBytes32,
  buildEnforcedOptions,
  MSG_TYPE_SEND,
  MSG_TYPE_SEND_AND_COMPOSE,
} from "./lib/layerzero-pathway.js";
import { EID_HUB, EID_SPOKE } from "./lib/layerzero-metadata.js";

loadEnv({ path: ".env.local" });
loadEnv();

const DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;
const DELIVERY_POLL_MS = 8_000;
const SCAN_TESTNET_BASE = "https://scan-testnet.layerzero-api.com/v1";

type MessagingFee = { nativeFee: bigint; lzTokenFee: bigint };
type MessagingReceipt = { guid: Hex; nonce: bigint; fee: MessagingFee };

type SmokeFlags = {
  tokenId: bigint;
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
    fail("Required: --token-id <uint256>");
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

function hubRpcUrl(): string {
  return (
    process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_RPC_84532?.trim() ||
    "https://sepolia.base.org"
  );
}

function spokeRpcUrl(): string {
  return (
    process.env.ETH_SEPOLIA_RPC_URL?.trim() ||
    "https://ethereum-sepolia-rpc.publicnode.com"
  );
}

function deployerAccount() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!pk) {
    fail("DEPLOYER_PRIVATE_KEY not set (.env.local)");
  }
  const hex = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(hex);
}

function optionsFor(msgType: typeof MSG_TYPE_SEND | typeof MSG_TYPE_SEND_AND_COMPOSE, remoteEid: number): Hex {
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
  publicClient: PublicClient;
  wallet: WalletClient;
  account: Address;
  oapp: Address;
  abi: typeof ProxyONFT721AdapterAbi | typeof KarPassportONFT721Abi;
  send: ReturnType<typeof sendParam>;
}): Promise<{ hash: Hex; receipt: MessagingReceipt; fee: MessagingFee }> {
  const fee = (await params.publicClient.readContract({
    address: params.oapp,
    abi: params.abi,
    functionName: "quoteSend",
    args: [params.send, false],
  })) as MessagingFee;

  const { request, result } = await params.publicClient.simulateContract({
    address: params.oapp,
    abi: params.abi,
    functionName: "send",
    args: [params.send, fee, params.account],
    account: params.account,
    value: fee.nativeFee,
  });

  const hash = await params.wallet.writeContract(request);
  await params.publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });

  const receipt = result as MessagingReceipt;
  return { hash, receipt, fee };
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

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const steps: StepResult[] = [];
  const legs: LegSummary[] = [];

  const hubManifest = requireSepoliaDeployment();
  const spokeManifest = requireSpokeDeployment();

  if (!hubManifest.proxyOnftAdapter) {
    fail(`proxyOnftAdapter missing in deployments/84532.json`);
  }
  if (!spokeManifest.karPassportOnft) {
    fail(`karPassportOnft missing in deployments/11155111.json`);
  }

  const adapter = getAddress(hubManifest.proxyOnftAdapter);
  const karPassport = getAddress(hubManifest.karPassport);
  const spokeOnft = getAddress(spokeManifest.karPassportOnft);

  const account = deployerAccount();
  const accountAddress = getAddress(account.address);

  const hubPublic = createPublicClient({
    chain: baseSepolia,
    transport: http(hubRpcUrl()),
  });
  const spokePublic = createPublicClient({
    chain: sepolia,
    transport: http(spokeRpcUrl()),
  });
  const hubWallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(hubRpcUrl()),
  });
  const spokeWallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(spokeRpcUrl()),
  });

  console.log("Kargain bridge smoke");
  console.log(`  tokenId:   ${flags.tokenId}`);
  console.log(`  recipient: ${accountAddress} (deployer)`);
  console.log(`  adapter:   ${adapter}`);
  console.log(`  passport:  ${karPassport}`);
  console.log(`  spoke:     ${spokeOnft}`);
  console.log(`  skipReturn:${flags.skipReturn}`);
  console.log("");

  // (0) wire read-only gate
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

  // Preflight
  const originalOwner = getAddress(
    (await hubPublic.readContract({
      address: karPassport,
      abi: KarPassportAbi,
      functionName: "ownerOf",
      args: [flags.tokenId],
    })) as Address,
  );
  if (originalOwner !== accountAddress) {
    fail(
      `Preflight: token ${flags.tokenId} owner ${originalOwner} ≠ deployer ${accountAddress}`,
    );
  }

  const statusBefore = Number(
    await hubPublic.readContract({
      address: karPassport,
      abi: KarPassportAbi,
      functionName: "passportStatus",
      args: [flags.tokenId],
    }),
  );
  const hubUriBefore = (await hubPublic.readContract({
    address: karPassport,
    abi: KarPassportAbi,
    functionName: "tokenURI",
    args: [flags.tokenId],
  })) as string;

  const approved = (await hubPublic.readContract({
    address: karPassport,
    abi: KarPassportAbi,
    functionName: "isApprovedForAll",
    args: [accountAddress, adapter],
  })) as boolean;
  if (!approved) {
    fail(
      `Preflight: setApprovalForAll(${adapter}, true) required on KarPassport before send`,
    );
  }

  console.log(`  preflight: owner=${originalOwner} status=${statusBefore} uri=${hubUriBefore}`);
  console.log("");

  // (1) quote hub→spoke
  const hubSendParam = sendParam(
    EID_SPOKE,
    accountAddress,
    flags.tokenId,
    optionsFor(MSG_TYPE_SEND_AND_COMPOSE, EID_SPOKE),
  );
  let hubFee: MessagingFee;
  try {
    hubFee = (await hubPublic.readContract({
      address: adapter,
      abi: ProxyONFT721AdapterAbi,
      functionName: "quoteSend",
      args: [hubSendParam, false],
    })) as MessagingFee;
    if (hubFee.nativeFee <= 0n) {
      fail(`(1) quoteSend nativeFee is ${hubFee.nativeFee} (expected > 0)`);
    }
    pass("1", `quoteSend hub→spoke fee=${hubFee.nativeFee} wei`);
    steps.push({ step: "1", ok: true, detail: `fee=${hubFee.nativeFee}` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (1) ${detail}`);
    steps.push({ step: "1", ok: false, detail });
    printSummary(legs, steps);
    process.exit(1);
  }

  // (2) send hub→spoke + poll delivery
  let hubLeg: LegSummary = {
    label: "hub→spoke",
    txHash: null,
    guid: null,
    feeWei: null,
    scanStatus: null,
  };
  try {
    const sent = await quoteAndSend({
      publicClient: hubPublic,
      wallet: hubWallet,
      account: accountAddress,
      oapp: adapter,
      abi: ProxyONFT721AdapterAbi,
      send: hubSendParam,
    });
    hubLeg = {
      label: "hub→spoke",
      txHash: sent.hash,
      guid: sent.receipt.guid,
      feeWei: sent.fee.nativeFee,
      scanStatus: null,
    };
    legs.push(hubLeg);
    console.log(`  send hub→spoke tx=${sent.hash} guid=${sent.receipt.guid}`);

    await pollUntil(
      "spoke ownerOf",
      async () => {
        const owner = getAddress(
          (await spokePublic.readContract({
            address: spokeOnft,
            abi: KarPassportONFT721Abi,
            functionName: "ownerOf",
            args: [flags.tokenId],
          })) as Address,
        );
        return owner === accountAddress;
      },
      DELIVERY_TIMEOUT_MS,
    );
    hubLeg.scanStatus = await fetchScanStatus(sent.receipt.guid);
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

  // (3) asserts after hub→spoke
  try {
    const spokeOwner = getAddress(
      (await spokePublic.readContract({
        address: spokeOnft,
        abi: KarPassportONFT721Abi,
        functionName: "ownerOf",
        args: [flags.tokenId],
      })) as Address,
    );
    const spokeUri = (await spokePublic.readContract({
      address: spokeOnft,
      abi: KarPassportONFT721Abi,
      functionName: "tokenURI",
      args: [flags.tokenId],
    })) as string;
    const hubOwner = getAddress(
      (await hubPublic.readContract({
        address: karPassport,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [flags.tokenId],
      })) as Address,
    );
    const statusAfter = Number(
      await hubPublic.readContract({
        address: karPassport,
        abi: KarPassportAbi,
        functionName: "passportStatus",
        args: [flags.tokenId],
      }),
    );

    const errors: string[] = [];
    if (spokeOwner !== accountAddress) {
      errors.push(`spoke ownerOf ${spokeOwner} ≠ recipient ${accountAddress}`);
    }
    if (spokeUri !== hubUriBefore) {
      errors.push(`spoke tokenURI mismatch (spoke=${spokeUri} hub=${hubUriBefore})`);
    }
    if (hubOwner !== adapter) {
      errors.push(`hub ownerOf ${hubOwner} ≠ adapter ${adapter}`);
    }
    if (statusAfter !== statusBefore) {
      errors.push(`passportStatus changed ${statusBefore} → ${statusAfter}`);
    }
    if (errors.length > 0) {
      fail(`(3) ${errors.join("; ")}`);
    }
    pass(
      "3",
      `spoke owner+URI ok; hub locked in adapter; status=${statusAfter} unchanged`,
    );
    steps.push({ step: "3", ok: true, detail: "post hub→spoke asserts" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (3) ${detail}`);
    steps.push({ step: "3", ok: false, detail });
    printSummary(legs, steps);
    process.exit(1);
  }

  if (flags.skipReturn) {
    console.log("");
    console.log("--skip-return: stopping after hub→spoke");
    printSummary(legs, steps);
    return;
  }

  // (4) return spoke→hub
  const returnParam = sendParam(
    EID_HUB,
    originalOwner,
    flags.tokenId,
    optionsFor(MSG_TYPE_SEND, EID_HUB),
  );
  let returnLeg: LegSummary = {
    label: "spoke→hub",
    txHash: null,
    guid: null,
    feeWei: null,
    scanStatus: null,
  };
  try {
    const returnFee = (await spokePublic.readContract({
      address: spokeOnft,
      abi: KarPassportONFT721Abi,
      functionName: "quoteSend",
      args: [returnParam, false],
    })) as MessagingFee;
    if (returnFee.nativeFee <= 0n) {
      fail(`(4) return quoteSend nativeFee is ${returnFee.nativeFee}`);
    }

    const sent = await quoteAndSend({
      publicClient: spokePublic,
      wallet: spokeWallet,
      account: accountAddress,
      oapp: spokeOnft,
      abi: KarPassportONFT721Abi,
      send: returnParam,
    });
    returnLeg = {
      label: "spoke→hub",
      txHash: sent.hash,
      guid: sent.receipt.guid,
      feeWei: sent.fee.nativeFee,
      scanStatus: null,
    };
    legs.push(returnLeg);
    console.log(`  send spoke→hub tx=${sent.hash} guid=${sent.receipt.guid}`);

    await pollUntil(
      "hub ownerOf unlock",
      async () => {
        const owner = getAddress(
          (await hubPublic.readContract({
            address: karPassport,
            abi: KarPassportAbi,
            functionName: "ownerOf",
            args: [flags.tokenId],
          })) as Address,
        );
        return owner === originalOwner;
      },
      DELIVERY_TIMEOUT_MS,
    );
    returnLeg.scanStatus = await fetchScanStatus(sent.receipt.guid);
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

  // (5) asserts after return
  try {
    const hubOwner = getAddress(
      (await hubPublic.readContract({
        address: karPassport,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [flags.tokenId],
      })) as Address,
    );
    const statusFinal = Number(
      await hubPublic.readContract({
        address: karPassport,
        abi: KarPassportAbi,
        functionName: "passportStatus",
        args: [flags.tokenId],
      }),
    );

    let spokeBurned = false;
    try {
      await spokePublic.readContract({
        address: spokeOnft,
        abi: KarPassportONFT721Abi,
        functionName: "ownerOf",
        args: [flags.tokenId],
      });
    } catch {
      spokeBurned = true;
    }

    const errors: string[] = [];
    if (hubOwner !== originalOwner) {
      errors.push(`hub ownerOf ${hubOwner} ≠ original ${originalOwner}`);
    }
    if (!spokeBurned) {
      errors.push("spoke ownerOf still succeeds (expected burn / revert)");
    }
    if (statusFinal !== statusBefore) {
      errors.push(`passportStatus changed ${statusBefore} → ${statusFinal}`);
    }
    if (errors.length > 0) {
      fail(`(5) ${errors.join("; ")}`);
    }
    pass("5", `hub unlocked to owner; spoke burned; status=${statusFinal} unchanged`);
    steps.push({ step: "5", ok: true, detail: "post return asserts" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  (5) ${detail}`);
    steps.push({ step: "5", ok: false, detail });
    printSummary(legs, steps);
    process.exit(1);
  }

  // (6) summary
  printSummary(legs, steps);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
