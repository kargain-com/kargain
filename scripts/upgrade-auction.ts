/**
 * Timelock48h-gated UUPS upgrade for AuctionEscrow on Base Sepolia (84532).
 *
 * Subcommands (exactly one):
 *   pnpm upgrade:auction -- --deploy-impl
 *   pnpm upgrade:auction -- --schedule
 *   pnpm upgrade:auction -- --execute
 *
 * Salt (deterministic):
 *   keccak256(toBytes(
 *     `kargain:84532:AuctionEscrow:upgradeToAndCall:${proxyLower}:${implLower}:${version}`
 *   ))
 *
 * Pending file (gitignored under deployments/*.json):
 *   deployments/84532.pending-auction-impl.json
 *
 * Does not change the proxy address, app env, or Ponder. Live txs are maintainer-only.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import hardhat from "hardhat";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  toBytes,
  toHex,
  type Hash,
} from "viem";

import { AuctionEscrowAbi } from "../lib/contracts/abis.generated.js";
import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import {
  requireSepoliaDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./lib/load-deployment.js";
import {
  auctionEscrowImplConstructorArgs,
} from "./lib/verify-constructor-args.js";
import { writeDeploymentManifest } from "./lib/write-deployment.js";

const BASESCAN = "https://sepolia.basescan.org";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;
const ZERO_BYTES32 = toHex(new Uint8Array(32)) as `0x${string}`;
const EMPTY_CALLDATA = "0x" as const;

export const PENDING_AUCTION_IMPL_PATH = join(
  process.cwd(),
  "deployments/84532.pending-auction-impl.json",
);

type ViemSuite = Awaited<ReturnType<typeof hardhat.network.connect>>["viem"];

type DeployResult = {
  address: `0x${string}`;
  txHash: Hash;
  blockNumber: bigint;
};

export type PendingAuctionImpl = {
  chainId: number;
  proxy: `0x${string}`;
  auctionEscrowImpl: `0x${string}`;
  version: string;
  blockNumber: string;
  txHash: Hash;
  salt?: `0x${string}`;
  operationId?: `0x${string}`;
  eta?: number;
};

function parseSubcommand(argv: string[]): "deploy-impl" | "schedule" | "execute" {
  const flags = [
    argv.includes("--deploy-impl") ? ("deploy-impl" as const) : null,
    argv.includes("--schedule") ? ("schedule" as const) : null,
    argv.includes("--execute") ? ("execute" as const) : null,
  ].filter((f): f is "deploy-impl" | "schedule" | "execute" => f != null);

  if (flags.length !== 1) {
    console.error(
      "Usage: pnpm upgrade:auction -- --deploy-impl | --schedule | --execute\n" +
        "(exactly one subcommand flag after `--`)",
    );
    process.exit(1);
  }
  return flags[0]!;
}

export function auctionUpgradeSalt(
  proxy: `0x${string}`,
  impl: `0x${string}`,
  version: string,
): `0x${string}` {
  return keccak256(
    toBytes(
      `kargain:${SEPOLIA_CHAIN_ID}:AuctionEscrow:upgradeToAndCall:${proxy.toLowerCase()}:${impl.toLowerCase()}:${version}`,
    ),
  );
}

export function upgradeToAndCallData(newImpl: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: AuctionEscrowAbi,
    functionName: "upgradeToAndCall",
    args: [newImpl, EMPTY_CALLDATA],
  });
}

export function readPendingAuctionImpl(): PendingAuctionImpl | null {
  if (!existsSync(PENDING_AUCTION_IMPL_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(PENDING_AUCTION_IMPL_PATH, "utf8")) as PendingAuctionImpl;
    return {
      ...raw,
      proxy: getAddress(raw.proxy),
      auctionEscrowImpl: getAddress(raw.auctionEscrowImpl),
    };
  } catch {
    return null;
  }
}

function writePendingAuctionImpl(pending: PendingAuctionImpl): void {
  mkdirSync(dirname(PENDING_AUCTION_IMPL_PATH), { recursive: true });
  writeFileSync(PENDING_AUCTION_IMPL_PATH, `${JSON.stringify(pending, null, 2)}\n`);
}

function deletePendingAuctionImpl(): void {
  if (existsSync(PENDING_AUCTION_IMPL_PATH)) {
    unlinkSync(PENDING_AUCTION_IMPL_PATH);
  }
}

async function waitForBytecode(viem: ViemSuite, address: `0x${string}`, label: string) {
  const publicClient = await viem.getPublicClient();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const bytecode = await publicClient.getBytecode({ address });
    if (bytecode && bytecode !== "0x") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} bytecode not visible on RPC after 120s (${address})`);
}

async function deployStep(
  viem: ViemSuite,
  label: string,
  contractName: string,
  constructorArgs: readonly unknown[] = [],
): Promise<DeployResult> {
  const publicClient = await viem.getPublicClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
        contractName,
        constructorArgs,
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: deploymentTransaction.hash,
        timeout: 180_000,
      });
      await waitForBytecode(viem, contract.address, label);
      console.log(`${label} tx: ${deploymentTransaction.hash} (block ${receipt.blockNumber})`);
      return {
        address: contract.address,
        txHash: deploymentTransaction.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (/TransactionNotFoundError|could not be found/i.test(message) && attempt < 5) {
        console.warn(`${label}: RPC lag on attempt ${attempt}, retrying in 5s…`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

function requireProxy(manifest: DeploymentManifest): `0x${string}` {
  if (!manifest.auctionEscrow) {
    throw new Error(
      "Manifest missing auctionEscrow — run pnpm deploy:auction before upgrading.",
    );
  }
  return getAddress(manifest.auctionEscrow);
}

function mergeImplIntoManifest(
  existing: DeploymentManifest,
  pending: PendingAuctionImpl,
): DeploymentManifest {
  return {
    ...existing,
    auctionEscrowImpl: pending.auctionEscrowImpl,
    blocks: {
      ...existing.blocks,
      auctionEscrowImpl: Number(pending.blockNumber),
    },
    txHashes: {
      ...existing.txHashes,
      auctionEscrowImpl: pending.txHash,
    },
    contractVersions: {
      ...(existing.contractVersions as DeploymentManifest["contractVersions"]),
      AuctionEscrow: CONTRACT_VERSIONS.AuctionEscrow,
    } as DeploymentManifest["contractVersions"],
    indexFromBlock: existing.indexFromBlock,
  };
}

async function cmdDeployImpl(viem: ViemSuite, manifest: DeploymentManifest) {
  const expected = CONTRACT_VERSIONS.AuctionEscrow;
  const proxy = requireProxy(manifest);
  const auction = await viem.getContractAt("AuctionEscrow", proxy);
  const proxyVersion = (await auction.read.VERSION([])) as string;

  if (proxyVersion === expected) {
    console.log(
      `Proxy already at ${expected} (${proxy}) — nothing to deploy. Aborting idempotently.`,
    );
    return;
  }

  const pending = readPendingAuctionImpl();
  if (pending) {
    if (
      pending.version === expected &&
      pending.chainId === SEPOLIA_CHAIN_ID &&
      getAddress(pending.proxy) === proxy
    ) {
      const pendingImpl = await viem.getContractAt("AuctionEscrow", pending.auctionEscrowImpl);
      let pendingVersion: string;
      try {
        pendingVersion = (await pendingImpl.read.VERSION([])) as string;
      } catch {
        throw new Error(
          `Stale pending file at ${PENDING_AUCTION_IMPL_PATH}: impl ${pending.auctionEscrowImpl} has no VERSION(). ` +
            "Confirm no timelock op is scheduled, then delete the pending file and re-run --deploy-impl.",
        );
      }
      if (pendingVersion === expected) {
        console.log("Pending impl already deployed — idempotent skip.");
        console.log(`  Impl:    ${pending.auctionEscrowImpl}`);
        console.log(`  VERSION: ${pendingVersion}`);
        console.log(`  Pending: ${PENDING_AUCTION_IMPL_PATH}`);
        console.log(`  Basescan: ${BASESCAN}/address/${pending.auctionEscrowImpl}`);
        console.log("");
        console.log("Next: pnpm verify:sepolia --auction-only && pnpm upgrade:auction -- --schedule");
        return;
      }
    }
    throw new Error(
      `Stale pending file at ${PENDING_AUCTION_IMPL_PATH} ` +
        `(version=${pending.version}, impl=${pending.auctionEscrowImpl}). ` +
        "Confirm no timelock operation is pending/ready, delete the file, then re-run --deploy-impl.",
    );
  }

  console.log(`Current proxy VERSION: ${proxyVersion}`);
  console.log(`Target VERSION:        ${expected}`);
  console.log("");

  const ctorArgs = auctionEscrowImplConstructorArgs(manifest);
  const impl = await deployStep(viem, "AuctionEscrow impl", "AuctionEscrow", [...ctorArgs]);
  const implContract = await viem.getContractAt("AuctionEscrow", impl.address);
  const implVersion = (await implContract.read.VERSION([])) as string;
  if (implVersion !== expected) {
    throw new Error(
      `New impl VERSION mismatch: expected ${expected}, got ${implVersion} (${impl.address})`,
    );
  }

  writePendingAuctionImpl({
    chainId: SEPOLIA_CHAIN_ID,
    proxy,
    auctionEscrowImpl: impl.address,
    version: expected,
    blockNumber: impl.blockNumber.toString(),
    txHash: impl.txHash,
  });

  console.log("");
  console.log("AuctionEscrow impl deployed (manifest unchanged):");
  console.log(`  Impl:    ${impl.address}`);
  console.log(`  VERSION: ${implVersion}`);
  console.log(`  Pending: ${PENDING_AUCTION_IMPL_PATH}`);
  console.log(`  Basescan: ${BASESCAN}/address/${impl.address}`);
  console.log("");
  console.log("Next: pnpm verify:sepolia --auction-only && pnpm upgrade:auction -- --schedule");
}

async function cmdSchedule(viem: ViemSuite, manifest: DeploymentManifest) {
  const expected = CONTRACT_VERSIONS.AuctionEscrow;
  const proxy = requireProxy(manifest);
  const pending = readPendingAuctionImpl();
  if (!pending) {
    throw new Error(
      `Missing ${PENDING_AUCTION_IMPL_PATH} — run pnpm upgrade:auction -- --deploy-impl first.`,
    );
  }
  if (pending.version !== expected || pending.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Pending version/chain mismatch (got version=${pending.version}, chainId=${pending.chainId}).`,
    );
  }
  if (getAddress(pending.proxy) !== proxy) {
    throw new Error(`Pending proxy ${pending.proxy} does not match manifest ${proxy}.`);
  }

  const auction = await viem.getContractAt("AuctionEscrow", proxy);
  const proxyVersion = (await auction.read.VERSION([])) as string;
  if (proxyVersion === expected) {
    console.log(`Proxy already at ${expected} — schedule not needed. Run --execute to finish manifest merge if pending remains.`);
    return;
  }

  const timelockAddress = getAddress(manifest.timelock ?? SEPOLIA_FALLBACK.timelock);
  const timelock = await viem.getContractAt("Timelock48h", timelockAddress);
  const delay = (await timelock.read.getMinDelay([])) as bigint;
  const data = upgradeToAndCallData(pending.auctionEscrowImpl);
  const salt = auctionUpgradeSalt(proxy, pending.auctionEscrowImpl, expected);
  const value = 0n;
  const predecessor = ZERO_BYTES32;

  const operationId = (await timelock.read.hashOperation([
    proxy,
    value,
    data,
    predecessor,
    salt,
  ])) as `0x${string}`;

  const done = (await timelock.read.isOperationDone([operationId])) as boolean;
  if (done) {
    console.log(`Operation already executed (${operationId}). Run --execute to merge manifest.`);
    return;
  }

  const pendingOp = (await timelock.read.isOperationPending([operationId])) as boolean;
  const ready = (await timelock.read.isOperationReady([operationId])) as boolean;
  if (pendingOp || ready) {
    const ts = Number((await timelock.read.getTimestamp([operationId])) as bigint);
    console.log("Operation already scheduled — idempotent skip.");
    console.log(`  Operation id: ${operationId}`);
    console.log(`  Ready:        ${ready}`);
    console.log(`  ETA (unix):   ${ts}`);
    console.log(`  ETA (UTC):    ${new Date(ts * 1000).toISOString()}`);
    writePendingAuctionImpl({
      ...pending,
      salt,
      operationId,
      eta: ts,
    });
    return;
  }

  console.log("Scheduling Timelock48h upgradeToAndCall…");
  console.log(`  Proxy:  ${proxy}`);
  console.log(`  Impl:   ${pending.auctionEscrowImpl}`);
  console.log(`  Delay:  ${delay}s`);
  console.log(`  Salt:   ${salt}`);
  console.log(`  Op id:  ${operationId}`);

  const publicClient = await viem.getPublicClient();
  const hash = await timelock.write.schedule([
    proxy,
    value,
    data,
    predecessor,
    salt,
    delay,
  ]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`schedule tx: ${hash} (block ${receipt.blockNumber})`);

  const eta = Number((await timelock.read.getTimestamp([operationId])) as bigint);
  writePendingAuctionImpl({
    ...pending,
    salt,
    operationId,
    eta,
  });

  console.log("");
  console.log("Scheduled. Wait until ETA, then:");
  console.log("  pnpm upgrade:auction -- --execute");
  console.log(`  Operation id: ${operationId}`);
  console.log(`  ETA (unix):   ${eta}`);
  console.log(`  ETA (UTC):    ${new Date(eta * 1000).toISOString()}`);
}

async function cmdExecute(viem: ViemSuite, manifest: DeploymentManifest) {
  const expected = CONTRACT_VERSIONS.AuctionEscrow;
  const proxy = requireProxy(manifest);
  const pending = readPendingAuctionImpl();
  if (!pending) {
    throw new Error(
      `Missing ${PENDING_AUCTION_IMPL_PATH} — nothing to execute. ` +
        "If the proxy is already upgraded, merge manifest manually or re-run --deploy-impl only if needed.",
    );
  }
  if (!pending.salt || !pending.operationId) {
    throw new Error(
      "Pending file missing salt/operationId — run pnpm upgrade:auction -- --schedule first.",
    );
  }

  const auction = await viem.getContractAt("AuctionEscrow", proxy);
  const proxyVersion = (await auction.read.VERSION([])) as string;
  const timelockAddress = getAddress(manifest.timelock ?? SEPOLIA_FALLBACK.timelock);

  if (proxyVersion === expected) {
    console.log(`Proxy already at ${expected} — merging manifest and clearing pending.`);
    const auth = getAddress((await auction.read.upgradeAuthority([])) as `0x${string}`);
    if (auth !== timelockAddress) {
      throw new Error(`upgradeAuthority drifted: expected ${timelockAddress}, got ${auth}`);
    }
    writeDeploymentManifest(SEPOLIA_DEPLOYMENT_PATH, mergeImplIntoManifest(manifest, pending));
    deletePendingAuctionImpl();
    console.log(`Manifest updated: ${SEPOLIA_DEPLOYMENT_PATH}`);
    console.log(`  auctionEscrowImpl → ${pending.auctionEscrowImpl}`);
    console.log(`  contractVersions.AuctionEscrow → ${expected}`);
    console.log("Next: pnpm smoke:sepolia; update SPEC I.9.1 impl row (see upgrade runbook).");
    return;
  }

  const timelock = await viem.getContractAt("Timelock48h", timelockAddress);
  const data = upgradeToAndCallData(pending.auctionEscrowImpl);
  const salt = pending.salt;
  const value = 0n;
  const predecessor = ZERO_BYTES32;
  const operationId = (await timelock.read.hashOperation([
    proxy,
    value,
    data,
    predecessor,
    salt,
  ])) as `0x${string}`;

  if (operationId !== pending.operationId) {
    throw new Error(
      `Operation id mismatch: pending ${pending.operationId} vs recomputed ${operationId}. ` +
        "Do not execute — salt/calldata drift.",
    );
  }

  const ready = (await timelock.read.isOperationReady([operationId])) as boolean;
  if (!ready) {
    const done = (await timelock.read.isOperationDone([operationId])) as boolean;
    const pendingOp = (await timelock.read.isOperationPending([operationId])) as boolean;
    const ts = Number((await timelock.read.getTimestamp([operationId])) as bigint);
    if (done) {
      throw new Error(
        `Operation ${operationId} is Done but proxy VERSION is still ${proxyVersion}. Investigate manually.`,
      );
    }
    if (pendingOp) {
      throw new Error(
        `Execute too early — operation Waiting until ETA ${ts} (${new Date(ts * 1000).toISOString()}).`,
      );
    }
    throw new Error(
      `Operation ${operationId} is not Ready (pending=${pendingOp}, done=${done}, timestamp=${ts}).`,
    );
  }

  console.log("Executing Timelock48h upgradeToAndCall…");
  console.log(`  Operation id: ${operationId}`);
  console.log(`  Impl:         ${pending.auctionEscrowImpl}`);

  const publicClient = await viem.getPublicClient();
  const hash = await timelock.write.execute([proxy, value, data, predecessor, salt]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`execute tx: ${hash} (block ${receipt.blockNumber})`);

  const newVersion = (await auction.read.VERSION([])) as string;
  if (newVersion !== expected) {
    throw new Error(`Post-execute VERSION mismatch: expected ${expected}, got ${newVersion}`);
  }
  const auth = getAddress((await auction.read.upgradeAuthority([])) as `0x${string}`);
  if (auth !== timelockAddress) {
    throw new Error(`upgradeAuthority changed after upgrade: expected ${timelockAddress}, got ${auth}`);
  }

  writeDeploymentManifest(SEPOLIA_DEPLOYMENT_PATH, mergeImplIntoManifest(manifest, pending));
  deletePendingAuctionImpl();

  console.log("");
  console.log("Upgrade complete:");
  console.log(`  Proxy:   ${proxy}`);
  console.log(`  Impl:    ${pending.auctionEscrowImpl}`);
  console.log(`  VERSION: ${newVersion}`);
  console.log(`  Authority: ${auth}`);
  console.log(`  Manifest: ${SEPOLIA_DEPLOYMENT_PATH}`);
  console.log("");
  console.log("Next: pnpm smoke:sepolia");
  console.log(
    "Then update SPEC I.9.1 AuctionEscrow impl row + drop the I.1 “84532 runs 1.0.0-draft” note.",
  );
}

async function main() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.error("DEPLOYER_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }

  const subcommand = parseSubcommand(process.argv.slice(2));
  const manifest = requireSepoliaDeployment();
  const connection = await hardhat.network.connect();
  const { viem } = connection;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`Expected chain ${SEPOLIA_CHAIN_ID}, got ${chainId}`);
    }

    const [deployer] = await viem.getWalletClients();
    console.log("Kargain AuctionEscrow Timelock UUPS upgrade — Base Sepolia");
    console.log(`Subcommand: ${subcommand}`);
    console.log(`Deployer:   ${getAddress(deployer.account.address)}`);
    console.log(`Chain:      ${chainId}`);
    console.log(`Target VERSION: ${CONTRACT_VERSIONS.AuctionEscrow}`);
    console.log("");

    if (subcommand === "deploy-impl") {
      await cmdDeployImpl(viem, manifest);
    } else if (subcommand === "schedule") {
      await cmdSchedule(viem, manifest);
    } else {
      await cmdExecute(viem, manifest);
    }
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
