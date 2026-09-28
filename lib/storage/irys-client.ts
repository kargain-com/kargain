import { WebUploader } from "@irys/web-upload";
import type BaseWebIrys from "@irys/web-upload/base";
import { WebBaseEth, WebEthereum } from "@irys/web-upload-ethereum";
import { EthersV6Adapter } from "@irys/web-upload-ethereum-ethers-v6";
import { BrowserProvider } from "ethers";
import type { Wallet } from "@wallet-standard/base";

import {
  buildIrysDepositPorts,
  ensureIrysDeposit,
  IrysDepositRefusal,
  type IrysDepositPorts,
} from "@/lib/storage/irys-deposit";
import {
  irysUploadPlanRefusalMessage,
  planIrysUpload,
  type IrysPaymentToken,
  type IrysUploadPlan,
} from "@/lib/storage/irys-upload-plan";
import type { ActiveAccount } from "@/lib/web3/active-account";
import type { CommercialActiveStack } from "@/lib/web3/commercial-active";
import { commercialActive } from "@/lib/web3/commercial-active";

export const IRYS_GATEWAY = "https://arweave.net";

export type IrysUploader = BaseWebIrys;

export type IrysTag = { name: string; value: string };

type TaggedFile = File & { tags?: IrysTag[] };

type Eip1193Provider = {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
};

/** HTTP timeout for Irys bundler requests (large photo batches can be slow). */
const UPLOAD_TIMEOUT_MS = 120_000;

type IrysEvmTokenConstructable = typeof WebBaseEth | typeof WebEthereum;

type IrysSolanaAdapterModule = {
  buildIrysSolanaUploader: (
    plan: IrysUploadPlan,
    provider: unknown,
    timeoutMs: number,
  ) => Promise<IrysUploader>;
};

type LoadIrysSolanaAdapter = () => Promise<IrysSolanaAdapterModule>;

function irysEvmTokenConstructable(
  token: Exclude<IrysPaymentToken, "solana">,
): IrysEvmTokenConstructable {
  switch (token) {
    case "base-eth":
      return WebBaseEth;
    case "ethereum":
      return WebEthereum;
    default: {
      const _exhaustive: never = token;
      throw new Error(`Unknown Irys payment token: ${_exhaustive}`);
    }
  }
}

let cachedUploader: {
  provider: unknown;
  cacheKey: string;
  uploader: IrysUploader;
} | null = null;

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("Irys upload requires a browser environment");
  }
}

function resolveProvider(provider?: unknown): Eip1193Provider {
  assertBrowser();
  const candidate = provider ?? window.ethereum;
  if (!candidate || typeof candidate !== "object" || !("request" in candidate)) {
    throw new Error("No EIP-1193 wallet provider available");
  }
  return candidate as Eip1193Provider;
}

async function readChainId(provider: Eip1193Provider): Promise<number> {
  const result = await provider.request({ method: "eth_chainId" });
  if (typeof result === "string") {
    return Number.parseInt(result, 16);
  }
  if (typeof result === "number") {
    return result;
  }
  throw new Error("Unable to read wallet chain ID");
}

function mergeTags(contentType: string, tags?: IrysTag[]): IrysTag[] {
  const merged = [...(tags ?? [])];
  if (!merged.some((tag) => tag.name === "Content-Type")) {
    merged.unshift({ name: "Content-Type", value: contentType });
  }
  return merged;
}

function photoUploadName(file: File, index: number): string {
  const match = file.name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = match?.[1]?.toLowerCase() ?? "jpg";
  return `photo-${String(index).padStart(3, "0")}.${ext}`;
}

async function loadIrysSolanaAdapter(
  loadModule: LoadIrysSolanaAdapter = () => import("@/adapters/irys-solana/build-uploader"),
): Promise<IrysSolanaAdapterModule> {
  try {
    const mod = await loadModule();
    if (typeof mod.buildIrysSolanaUploader !== "function") {
      throw new Error("module does not export buildIrysSolanaUploader");
    }
    return mod;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load Solana Irys adapter: ${message}`);
  }
}

export async function buildIrysUploaderFromPlan(
  plan: IrysUploadPlan,
  provider: unknown,
  options?: {
    loadSolanaAdapter?: LoadIrysSolanaAdapter;
  },
): Promise<IrysUploader> {
  if (plan.paymentToken === "solana") {
    const solana = await loadIrysSolanaAdapter(options?.loadSolanaAdapter);
    return solana.buildIrysSolanaUploader(plan, provider, UPLOAD_TIMEOUT_MS);
  }

  const eip1193 = resolveProvider(provider);
  const ethersProvider = new BrowserProvider(eip1193);
  const Token = irysEvmTokenConstructable(plan.paymentToken);

  let builder = WebUploader(Token)
    .withAdapter(EthersV6Adapter(ethersProvider))
    .bundlerUrl(plan.bundlerUrl)
    .withRpc(plan.rpcUrl)
    .timeout(UPLOAD_TIMEOUT_MS);

  if (plan.devnet) {
    builder = builder.devnet();
  }

  return builder;
}

export async function getIrysUploaderForStack(
  stack: CommercialActiveStack,
  provider: unknown,
  options?: {
    loadSolanaAdapter?: LoadIrysSolanaAdapter;
  },
): Promise<IrysUploader> {
  assertBrowser();
  const planned = planIrysUpload(stack);
  if (!planned.ok) {
    throw new Error(irysUploadPlanRefusalMessage(planned.cause));
  }
  const { plan } = planned;
  const cacheKey = [
    plan.paymentToken,
    plan.bundlerUrl,
    plan.rpcUrl,
    plan.devnet ? "devnet" : "mainnet",
  ].join("|");
  if (
    cachedUploader &&
    cachedUploader.provider === provider &&
    cachedUploader.cacheKey === cacheKey
  ) {
    return cachedUploader.uploader;
  }
  const uploader = await buildIrysUploaderFromPlan(plan, provider, options);
  cachedUploader = { provider, cacheKey, uploader };
  return uploader;
}

/**
 * EVM EIP-1193 helper — reads chain id from the provider.
 * Product upload paths must use {@link getIrysUploaderForStack} via
 * `resolveIrysUploadSession` (SVM has no eth_chainId).
 */
export async function getIrysUploader(provider: unknown): Promise<IrysUploader> {
  assertBrowser();
  const providerKey = provider ?? window.ethereum;

  try {
    const eip1193 = resolveProvider(providerKey);
    const chainId = await readChainId(eip1193);
    const stack = commercialActive(chainId);
    if (!stack) {
      throw new Error(irysUploadPlanRefusalMessage("wrong_vm"));
    }
    return getIrysUploaderForStack(stack, providerKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect Irys uploader: ${message}`);
  }
}

/** Drop cached uploader after a failed upload so the next attempt reconnects cleanly. */
export function resetIrysUploaderCache(): void {
  cachedUploader = null;
}

export async function uploadFileWithUploader(
  uploader: IrysUploader,
  file: File,
  tags?: IrysTag[],
): Promise<string> {
  const receipt = await uploader.uploadFile(file, {
    tags: mergeTags(file.type || "application/octet-stream", tags),
  });
  return `ar://${receipt.id}`;
}

/**
 * Upload multiple files with one wallet signature via an Irys nested bundle.
 * A single file uses {@link uploadFileWithUploader} directly.
 */
export async function uploadFilesWithUploader(
  uploader: IrysUploader,
  files: File[],
  tags?: IrysTag[],
): Promise<string[]> {
  if (files.length === 0) return [];

  if (files.length === 1) {
    return [await uploadFileWithUploader(uploader, files[0]!, tags)];
  }

  const taggedFiles: TaggedFile[] = files.map((file, index) => {
    const contentType = file.type || "image/jpeg";
    const named = new File([file], photoUploadName(file, index), { type: contentType });
    return Object.assign(named, {
      tags: mergeTags(contentType, tags),
    });
  });

  const result = await uploader.uploadFolder(taggedFiles);

  return taggedFiles.map((file) => {
    const entry = result.manifest.paths[file.name];
    if (!entry?.id) {
      throw new Error(`Upload succeeded but Arweave id missing for ${file.name}`);
    }
    return `ar://${entry.id}`;
  });
}

export async function uploadJsonWithUploader(
  uploader: IrysUploader,
  data: object,
  tags?: IrysTag[],
): Promise<string> {
  const body = JSON.stringify(data);
  const receipt = await uploader.upload(body, {
    tags: mergeTags("application/json", tags),
  });
  return `ar://${receipt.id}`;
}

export type PrepareUserPaidUploadArgs = {
  stack: CommercialActiveStack;
  provider: unknown;
  totalBytes: number;
  account: ActiveAccount;
  svmWallet?: Wallet | null;
  /** Injectable deposit ports (tests). Defaults from account + provider + wallet. */
  depositPorts?: IrysDepositPorts;
};

/**
 * Ensure Irys balance via {@link ensureIrysDeposit}, then return the uploader.
 * Never calls SDK `fund()`.
 */
export async function prepareUserPaidUploadForStack(
  args: PrepareUserPaidUploadArgs,
): Promise<IrysUploader> {
  const planned = planIrysUpload(args.stack);
  if (!planned.ok) {
    throw new Error(irysUploadPlanRefusalMessage(planned.cause));
  }
  const uploader = await getIrysUploaderForStack(args.stack, args.provider);
  const ports =
    args.depositPorts ??
    buildIrysDepositPorts({
      stack: args.stack,
      provider: args.provider,
      svmWallet: args.svmWallet,
    });
  const deposit = await ensureIrysDeposit({
    stack: args.stack,
    account: args.account,
    uploader,
    totalBytes: args.totalBytes,
    paymentToken: planned.plan.paymentToken,
    bundlerUrl: planned.plan.bundlerUrl,
    ports,
  });
  if (!deposit.ok) {
    throw new IrysDepositRefusal(deposit.cause, deposit.detail);
  }
  return uploader;
}
