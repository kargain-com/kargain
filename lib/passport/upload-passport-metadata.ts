import {
  getIrysUploaderForStack,
  prepareUserPaidUploadForStack,
  uploadFilesWithUploader,
  uploadJsonWithUploader,
  type IrysTag,
  type IrysUploader,
} from "@/lib/storage/irys-client";
import {
  irysUploadPlanRefusalMessage,
} from "@/lib/storage/irys-upload-plan";
import { withRetry } from "@/lib/storage/upload-with-retry";
import {
  commercialNamespaceOf,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialActiveStack,
} from "@/lib/web3/commercial-active";
import type { Wallet } from "@wallet-standard/base";

export type { IrysTag };

export type UploadProgress =
  | { kind: "photos"; current: number; total: number; batch?: boolean }
  | { kind: "metadata" };

export type WalletUploadProviderArgs = {
  account: ActiveAccount;
  evmConnector?: { getProvider?: () => Promise<unknown> };
  svmWallet?: Wallet | null;
};

export type IrysUploadSession = {
  stack: CommercialActiveStack;
  provider: unknown;
};

const PHOTO_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-photo" },
];

const METADATA_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-metadata" },
  { name: "version", value: "1.1" },
];

export function formatPassportUploadError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes("User rejected")) {
      return "Wallet signature cancelled.";
    }
    if (err.message.includes("402 error")) {
      return "Your Irys storage balance is too low. Confirm the deposit transaction in your wallet, then try again.";
    }
    if (err.message.includes("not sent to any of this bundler")) {
      return (
        "Your wallet could not deposit to Irys storage. Smart contract wallets often cannot send " +
        "the required direct transfer. Try fewer optimized photos, or switch to a standard MetaMask " +
        "account for upload. Minting still works with any wallet."
      );
    }
    if (err.message.includes("failed to post funding tx")) {
      return "The Irys storage deposit could not be confirmed. Wait a minute and try again, or use a standard wallet (EOA) on a supported testnet.";
    }
    return err.message;
  }
  return "Upload failed. Please try again.";
}

/**
 * One door for the wallet provider Irys will pay from.
 * Call sites pass account + family handles — no `if (vm)` at the wizard.
 */
export async function getWalletUploadProvider(
  args: WalletUploadProviderArgs,
): Promise<unknown> {
  if (args.account.status !== "connected") {
    throw new Error("Connect your wallet to continue");
  }
  if (args.account.vm === "evm") {
    const provider =
      (await args.evmConnector?.getProvider?.()) ??
      (typeof window !== "undefined" ? window.ethereum : undefined);
    if (!provider) {
      throw new Error("Connect your wallet to continue");
    }
    return provider;
  }
  if (args.svmWallet == null) {
    throw new Error("Connect your wallet to continue");
  }
  return args.svmWallet;
}

/**
 * Resolve commercial stack + provider for a paid Irys session.
 * Stack comes from {@link commercialNamespaceOf} — never an invented SVM chain id.
 */
export async function resolveIrysUploadSession(
  args: WalletUploadProviderArgs,
): Promise<IrysUploadSession> {
  const ns = commercialNamespaceOf(args.account);
  if (!ns.ok) {
    if (ns.cause === "disconnected") {
      throw new Error("Connect your wallet to continue");
    }
    // 0 or >1 commercial SVM rows — never invent a payment network.
    throw new Error("Commercial network for this wallet is unresolved.");
  }
  const stack = commercialActive(Number(ns.namespace));
  if (stack == null) {
    throw new Error(irysUploadPlanRefusalMessage("wrong_vm"));
  }
  const provider = await getWalletUploadProvider(args);
  return { stack, provider };
}

export async function uploadPassportPhotos(
  files: File[],
  session: IrysUploadSession,
  onProgress?: (progress: UploadProgress) => void,
): Promise<{ uris: string[]; uploader: IrysUploader }> {
  if (files.length === 0) {
    onProgress?.({ kind: "metadata" });
    const uploader = await getIrysUploaderForStack(
      session.stack,
      session.provider,
    );
    return { uris: [], uploader };
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const uploader = await prepareUserPaidUploadForStack(
    session.stack,
    session.provider,
    totalBytes,
  );
  const batch = files.length > 1;

  onProgress?.({ kind: "photos", current: 0, total: files.length, batch });

  const uris = await withRetry(() =>
    uploadFilesWithUploader(uploader, files, PHOTO_TAGS),
  );

  onProgress?.({
    kind: "photos",
    current: files.length,
    total: files.length,
    batch,
  });
  return { uris, uploader };
}

export async function uploadPassportMetadataJson(
  metadata: Record<string, unknown>,
  session: IrysUploadSession,
  onProgress?: (progress: UploadProgress) => void,
  uploader?: IrysUploader,
): Promise<string> {
  onProgress?.({ kind: "metadata" });
  if (uploader) {
    return withRetry(() =>
      uploadJsonWithUploader(uploader, metadata, METADATA_TAGS),
    );
  }
  const built = await prepareUserPaidUploadForStack(
    session.stack,
    session.provider,
    new TextEncoder().encode(JSON.stringify(metadata)).length,
  );
  return withRetry(() =>
    uploadJsonWithUploader(built, metadata, METADATA_TAGS),
  );
}

/**
 * Photo upload (batch), and metadata JSON upload on one Irys session.
 * `buildMetadata` receives URIs for newly uploaded files only (in upload order).
 */
export async function uploadPassportToIrys(params: {
  newPhotoFiles: File[];
  buildMetadata: (uploadedNewPhotoUris: string[]) => Record<string, unknown>;
  account: ActiveAccount;
  evmConnector?: WalletUploadProviderArgs["evmConnector"];
  svmWallet?: Wallet | null;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<string> {
  const session = await resolveIrysUploadSession({
    account: params.account,
    evmConnector: params.evmConnector,
    svmWallet: params.svmWallet,
  });
  const { uris: uploadedNewUris, uploader } = await uploadPassportPhotos(
    params.newPhotoFiles,
    session,
    params.onProgress,
  );
  const metadata = params.buildMetadata(uploadedNewUris);
  return uploadPassportMetadataJson(
    metadata,
    session,
    params.onProgress,
    uploader,
  );
}
