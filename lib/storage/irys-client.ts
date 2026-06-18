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

async function ensureFunded(uploader: IrysUploader, totalBytes: number): Promise<void> {
  if (isDevnetEnvironment()) {
    return;
  }

  const price = await uploader.getPrice(totalBytes);
  const balance = await uploader.getBalance();

  if (balance.lt(price)) {
    const needed = price.minus(balance);
    const withBuffer = needed.multipliedBy(1.1);
    await uploader.fund(withBuffer);
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
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  await ensureFunded(uploader, totalBytes);

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
  await ensureFunded(uploader, new TextEncoder().encode(body).length);
  const receipt = await uploader.upload(body, {
    tags: mergeTags("application/json", tags),
  });
  return `ar://${receipt.id}`;
}
