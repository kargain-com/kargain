import { WebUploader } from "@irys/web-upload";
import type BaseWebIrys from "@irys/web-upload/base";
import { WebBaseEth } from "@irys/web-upload-ethereum";
import { EthersV6Adapter } from "@irys/web-upload-ethereum-ethers-v6";
import { BrowserProvider } from "ethers";

import { rpcUrlForChain } from "@/lib/web3/supported-chains";

export const IRYS_GATEWAY = "https://arweave.net";

export type IrysUploader = BaseWebIrys;

export type IrysTag = { name: string; value: string };

type Eip1193Provider = {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
};

const BASE_CHAIN_IDS = new Set([8453, 84532]);

/** HTTP timeout for Irys bundler requests (large photo batches can be slow). */
const UPLOAD_TIMEOUT_MS = 120_000;

const DEFAULT_NODE_URL = "https://node2.irys.xyz";

/** Extra bytes reserved for bundle overhead when pre-funding multi-file uploads. */
const BUNDLE_OVERHEAD_BYTES = 16_384;

/** Gas fee multiplier passed to Irys fund() for congested testnets. */
const FUND_FEE_MULTIPLIER = 1.2;

const FUND_POLL_INTERVAL_MS = 2_000;
const FUND_POLL_TIMEOUT_MS = 60_000;

type IrysBalance = Awaited<ReturnType<IrysUploader["getBalance"]>>;

async function waitForFundingConfirmation(
  uploader: IrysUploader,
  requiredBalance: IrysBalance,
  timeoutMs = FUND_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const balance = await uploader.getBalance();
    if (balance.gte(requiredBalance)) return;
    await new Promise((resolve) => setTimeout(resolve, FUND_POLL_INTERVAL_MS));
  }
  throw new Error(
    "Irys deposit did not confirm within 60 seconds. Please try again.",
  );
}

let cachedUploader: { provider: unknown; uploader: IrysUploader } | null = null;

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

function nodeUrl(): string {
  return process.env.NEXT_PUBLIC_IRYS_NODE_URL?.trim() || DEFAULT_NODE_URL;
}

function isDevnetEnvironment(): boolean {
  return nodeUrl().includes("devnet");
}

function mergeTags(contentType: string, tags?: IrysTag[]): IrysTag[] {
  const merged = [...(tags ?? [])];
  if (!merged.some((tag) => tag.name === "Content-Type")) {
    merged.unshift({ name: "Content-Type", value: contentType });
  }
  return merged;
}

/**
 * Ensure the connected wallet has funded its Irys balance for the upcoming upload.
 * The user pays storage from their own wallet via a direct ETH transfer to Irys.
 */
async function ensureFunded(uploader: IrysUploader, totalBytes: number): Promise<void> {
  const bytes = Math.ceil(totalBytes * 1.15) + BUNDLE_OVERHEAD_BYTES;
  const price = await uploader.getPrice(bytes);
  const balance = await uploader.getBalance();

  if (balance.lt(price)) {
    const needed = price.minus(balance).multipliedBy(1.1).integerValue(2);
    if (needed.gt(0)) {
      await uploader.fund(needed, FUND_FEE_MULTIPLIER);
      await waitForFundingConfirmation(uploader, price);
    }
  }
}

export async function getIrysUploader(provider: unknown): Promise<IrysUploader> {
  assertBrowser();
  const providerKey = provider ?? window.ethereum;

  if (cachedUploader && cachedUploader.provider === providerKey) {
    return cachedUploader.uploader;
  }

  try {
    const eip1193 = resolveProvider(providerKey);
    const chainId = await readChainId(eip1193);

    if (!BASE_CHAIN_IDS.has(chainId)) {
      throw new Error(`Unsupported chain for Irys uploads: ${chainId}`);
    }

    const ethersProvider = new BrowserProvider(eip1193);
    const url = nodeUrl();

    const builder = WebUploader(WebBaseEth)
      .withAdapter(EthersV6Adapter(ethersProvider))
      .bundlerUrl(url)
      .withRpc(rpcUrlForChain(chainId))
      .timeout(UPLOAD_TIMEOUT_MS);

    const uploader = await builder;
    cachedUploader = { provider: providerKey, uploader };
    return uploader;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect Irys uploader: ${message}`);
  }
}

export function isIrysDevnet(): boolean {
  return isDevnetEnvironment();
}

/** Drop cached uploader after a failed upload so the next attempt reconnects cleanly. */
export function resetIrysUploaderCache(): void {
  cachedUploader = null;
}

export async function uploadFile(
  file: File,
  tags?: IrysTag[],
  provider?: unknown,
): Promise<string> {
  const uploader = await getIrysUploader(provider);
  await ensureFunded(uploader, file.size);
  return uploadFileWithUploader(uploader, file, tags);
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

/** Fund the user's Irys balance for a total byte size, then return the uploader. */
export async function prepareUserPaidUpload(
  provider: unknown,
  totalBytes: number,
): Promise<IrysUploader> {
  const uploader = await getIrysUploader(provider);
  await ensureFunded(uploader, totalBytes);
  return uploader;
}

/** Upload files sequentially; user funds Irys once, then signs each upload from their wallet. */
export async function uploadFiles(
  files: File[],
  tags?: IrysTag[],
  provider?: unknown,
): Promise<string[]> {
  if (files.length === 0) return [];

  const uploader = await getIrysUploader(provider);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  await ensureFunded(uploader, totalBytes);

  const uris: string[] = [];
  for (const file of files) {
    uris.push(await uploadFileWithUploader(uploader, file, tags));
  }
  return uris;
}

export async function uploadJson(
  data: object,
  tags?: IrysTag[],
  provider?: unknown,
): Promise<string> {
  const uploader = await getIrysUploader(provider);
  const body = JSON.stringify(data);
  await ensureFunded(uploader, new TextEncoder().encode(body).length);
  const receipt = await uploader.upload(body, {
    tags: mergeTags("application/json", tags),
  });
  return `ar://${receipt.id}`;
}
