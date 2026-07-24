import { WebUploader } from "@irys/web-upload";
import type BaseWebIrys from "@irys/web-upload/base";
import { WebBaseEth, WebEthereum } from "@irys/web-upload-ethereum";
import { EthersV6Adapter } from "@irys/web-upload-ethereum-ethers-v6";
import { BrowserProvider } from "ethers";

import { estimateIrysUploadBytes } from "@/lib/storage/irys-upload-estimate";
import {
  planIrysUpload,
  type IrysPaymentToken,
} from "@/lib/storage/irys-upload-plan";

export const IRYS_GATEWAY = "https://arweave.net";

export type IrysUploader = BaseWebIrys;

export type IrysTag = { name: string; value: string };

type TaggedFile = File & { tags?: IrysTag[] };

type Eip1193Provider = {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
};

/** HTTP timeout for Irys bundler requests (large photo batches can be slow). */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Gas fee multiplier passed to Irys fund() for congested testnets. */
const FUND_FEE_MULTIPLIER = 1.2;

const FUND_POLL_INTERVAL_MS = 2_000;
const FUND_POLL_TIMEOUT_MS = 60_000;

type IrysBalance = Awaited<ReturnType<IrysUploader["getBalance"]>>;

type IrysTokenConstructable = typeof WebBaseEth | typeof WebEthereum;

function irysTokenConstructable(token: IrysPaymentToken): IrysTokenConstructable {
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

let cachedUploader: {
  provider: unknown;
  chainId: number;
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

/**
 * Ensure the connected wallet has funded its Irys balance for the upcoming upload.
 * The user pays storage from their own wallet via a direct ETH transfer to Irys.
 */
async function ensureFunded(uploader: IrysUploader, totalBytes: number): Promise<void> {
  const bytes = estimateIrysUploadBytes(totalBytes);
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

  try {
    const eip1193 = resolveProvider(providerKey);
    const chainId = await readChainId(eip1193);

    if (
      cachedUploader &&
      cachedUploader.provider === providerKey &&
      cachedUploader.chainId === chainId
    ) {
      return cachedUploader.uploader;
    }

    const plan = planIrysUpload(chainId);
    const ethersProvider = new BrowserProvider(eip1193);
    const Token = irysTokenConstructable(plan.paymentToken);

    let builder = WebUploader(Token)
      .withAdapter(EthersV6Adapter(ethersProvider))
      .bundlerUrl(plan.bundlerUrl)
      .withRpc(plan.rpcUrl)
      .timeout(UPLOAD_TIMEOUT_MS);

    if (plan.devnet) {
      builder = builder.devnet();
    }

    const uploader = await builder;
    cachedUploader = { provider: providerKey, chainId, uploader };
    return uploader;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect Irys uploader: ${message}`);
  }
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

/**
 * Upload multiple files with one wallet signature via an Irys nested bundle.
 * A single file uses `uploadFile` directly.
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
  await ensureFunded(uploader, new TextEncoder().encode(body).length);
  const receipt = await uploader.upload(body, {
    tags: mergeTags("application/json", tags),
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

/** User funds Irys once, then signs one batch upload (or one file) from their wallet. */
export async function uploadFiles(
  files: File[],
  tags?: IrysTag[],
  provider?: unknown,
): Promise<string[]> {
  if (files.length === 0) return [];

  const uploader = await getIrysUploader(provider);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  await ensureFunded(uploader, totalBytes);
  return uploadFilesWithUploader(uploader, files, tags);
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
