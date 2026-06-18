import { WebUploader } from "@irys/web-upload";
import type BaseWebIrys from "@irys/web-upload/base";
import { WebBaseEth } from "@irys/web-upload-ethereum";
import { EthersV6Adapter } from "@irys/web-upload-ethereum-ethers-v6";
import { BrowserProvider } from "ethers";

import { rpcUrlForChain } from "@/lib/web3/supported-chains";

export const IRYS_GATEWAY = "https://arweave.net";

export type IrysUploader = BaseWebIrys;

type Eip1193Provider = {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
};

type IrysTag = { name: string; value: string };

type TaggedFile = File & { tags?: IrysTag[] };

const BASE_CHAIN_IDS = new Set([8453, 84532]);

/** HTTP timeout for Irys bundler requests (large photo batches can be slow). */
const UPLOAD_TIMEOUT_MS = 120_000;

const DEFAULT_NODE_URL = "https://devnet.irys.xyz";

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

/** Extra bytes reserved for Irys bundle/manifest overhead on multi-file uploads. */
const BUNDLE_OVERHEAD_BYTES = 16_384;

/** Gas fee multiplier passed to Irys fund() for congested testnets. */
const FUND_FEE_MULTIPLIER = 1.2;

async function isSmartContractWallet(
  provider: Eip1193Provider,
  address: string,
): Promise<boolean> {
  const code = await provider.request({
    method: "eth_getCode",
    params: [address, "latest"],
  });
  return typeof code === "string" && code !== "0x" && code.length > 2;
}

async function ensureFunded(
  uploader: IrysUploader,
  totalBytes: number,
  provider?: unknown,
): Promise<void> {
  if (provider) {
    const eip1193 = resolveProvider(provider);
    const walletAddress = uploader.address;
    if (walletAddress && (await isSmartContractWallet(eip1193, walletAddress))) {
      // Smart wallets (e.g. Coinbase Smart Wallet) route ETH via contract calls.
      // Irys only accepts funding txs whose top-level `to` is the bundler address.
      return;
    }
  }

  const bytes = Math.ceil(totalBytes * 1.15) + BUNDLE_OVERHEAD_BYTES;
  const price = await uploader.getPrice(bytes);
  const balance = await uploader.getBalance();

  if (balance.lt(price)) {
    const needed = price.minus(balance).multipliedBy(1.1).integerValue(2);
    if (needed.gt(0)) {
      await uploader.fund(needed, FUND_FEE_MULTIPLIER);
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

    let builder = WebUploader(WebBaseEth)
      .withAdapter(EthersV6Adapter(ethersProvider))
      .bundlerUrl(url)
      .withRpc(rpcUrlForChain(chainId))
      .timeout(UPLOAD_TIMEOUT_MS);

    if (url.includes("devnet")) {
      builder = builder.devnet();
    }

    const uploader = await builder;
    cachedUploader = { provider: providerKey, uploader };
    return uploader;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect Irys uploader: ${message}`);
  }
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
  await ensureFunded(uploader, file.size, provider);
  const receipt = await uploader.uploadFile(file, {
    tags: mergeTags(file.type || "application/octet-stream", tags),
  });
  return `ar://${receipt.id}`;
}

/**
 * Upload multiple files in one Irys nested bundle (one wallet signature for the batch).
 * Falls back to a single `uploadFile` call when only one file is provided.
 */
export async function uploadFiles(
  files: File[],
  tags?: IrysTag[],
  provider?: unknown,
): Promise<string[]> {
  if (files.length === 0) return [];

  const uploader = await getIrysUploader(provider);
  const totalBytes =
    files.reduce((sum, file) => sum + file.size, 0) +
    (files.length > 1 ? BUNDLE_OVERHEAD_BYTES : 0);
  await ensureFunded(uploader, totalBytes, provider);

  if (files.length === 1) {
    const file = files[0]!;
    const receipt = await uploader.uploadFile(file, {
      tags: mergeTags(file.type || "application/octet-stream", tags),
    });
    return [`ar://${receipt.id}`];
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

export async function uploadJson(
  data: object,
  tags?: IrysTag[],
  provider?: unknown,
): Promise<string> {
  const uploader = await getIrysUploader(provider);
  const body = JSON.stringify(data);
  await ensureFunded(uploader, new TextEncoder().encode(body).length, provider);
  const receipt = await uploader.upload(body, {
    tags: mergeTags("application/json", tags),
  });
  return `ar://${receipt.id}`;
}
