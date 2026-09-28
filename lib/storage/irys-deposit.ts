/**
 * Sole Irys storage-deposit owner — balance-first, pending-record, no SDK fund().
 *
 * Never uses `runTx` (Irys transfers are invisible to indexer sync).
 * Never calls `uploader.fund` / `submitFundTransaction`.
 */

import type { Wallet } from "@wallet-standard/base";

import { estimateIrysUploadBytes } from "@/lib/storage/irys-upload-estimate";
import {
  postIrysBundlerDepositTx,
  type IrysBundlerDepositPostClass,
} from "@/lib/storage/irys-bundler-deposit-post";
import {
  clearIrysDepositRecord,
  createLocalStorageIrysDepositRecordStore,
  irysDepositRecordKey,
  probeIrysDepositRecordStoreWritable,
  readIrysDepositRecord,
  writeIrysDepositRecord,
  type IrysDepositRecord,
  type IrysDepositRecordStore,
} from "@/lib/storage/irys-deposit-record";
import type { IrysPaymentToken } from "@/lib/storage/irys-upload-plan";
import {
  type ActiveAccount,
} from "@/lib/web3/active-account";
import {
  type CommercialActiveStack,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { getPublicClient } from "@/lib/web3/public-client";
import { createProductSvmFundingTxConfirmPort } from "@/lib/web3/svm-rpc";
import {
  sendSvmNativeTransfer,
  type SvmSignAndSendPort,
} from "@/lib/web3/svm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmTxConfirmPort } from "@/lib/web3/svm-tx-confirm";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
  type TxWriteUnavailable,
} from "@/lib/web3/tx-write-availability";
import {
  isWalletRejection,
  walletRejectionCopy,
} from "@/lib/web3/wallet-rejection";
import {
  readAccountKind,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";

/**
 * Irys `@irys` BaseWebToken.minConfirm — base-eth / ethereum inherit 5.
 * Measured from package; never invent for an unknown token.
 */
export const IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS = 5 as const;

/**
 * Deposit amount = ceil((price − balance) × 11/10).
 * Wallet pays chain fees separately — never the SDK 1.2 gas multiplier.
 */
export const IRYS_DEPOSIT_AMOUNT_NUMERATOR = 11n;
export const IRYS_DEPOSIT_AMOUNT_DENOMINATOR = 10n;

/** Minimal uploader surface the deposit owner reads — avoids circular import with irys-client. */
export type IrysDepositUploader = {
  getPrice: (bytes: number) => Promise<{ toString: () => string }>;
  getBalance: () => Promise<{ toString: () => string }>;
  utils: {
    getBundlerAddress: (token?: string) => Promise<string>;
  };
};

export type IrysDepositCause =
  | "deposit_record_unavailable"
  | "deposit_contract_wallet"
  | "deposit_pending"
  | "deposit_write_unavailable"
  | "deposit_send_failed"
  | "deposit_landed_error"
  | "deposit_credit_short"
  | "deposit_unknown_token"
  | "wallet_rejected";

export type IrysDepositResult =
  | { ok: true }
  | { ok: false; cause: IrysDepositCause; detail?: string };

export type IrysEvmDepositSendPort = {
  sendTransaction: (args: {
    to: `0x${string}`;
    value: bigint;
    chainId: number;
  }) => Promise<`0x${string}`>;
};

export type IrysDepositPorts = {
  /** SVM Wallet Standard sign-and-send (required when stack.vm === svm). */
  svmSignAndSend?: SvmSignAndSendPort;
  /** EVM native send (required when stack.vm === evm). */
  sendEvmTransaction?: IrysEvmDepositSendPort;
  /** Override account-kind reader (defaults to {@link readAccountKind}). */
  readEvmAccountKind?: (
    chainId: number,
    address: `0x${string}`,
  ) => Promise<WalletAccountKind>;
  /** Injectable SVM funding confirm (defaults to product finalized port). */
  confirmSvmFunding?: SvmTxConfirmPort;
  /**
   * Injectable EVM confirmations wait.
   * Defaults to receipt + {@link IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS}.
   */
  waitEvmConfirmations?: (args: {
    chainId: number;
    txHash: `0x${string}`;
    minConfirmations: number;
  }) => Promise<void>;
  /** Injectable bundler POST (defaults to {@link postIrysBundlerDepositTx}). */
  postBundlerDeposit?: (args: {
    bundlerUrl: string;
    token: string;
    txId: string;
  }) => Promise<{ statusClass: IrysBundlerDepositPostClass; httpStatus: number }>;
  store?: IrysDepositRecordStore;
};

export function irysDepositCauseCopy(cause: IrysDepositCause): string {
  switch (cause) {
    case "deposit_record_unavailable":
      return "Storage deposit could not be tracked in this browser. Enable site storage and try again.";
    case "deposit_contract_wallet":
      return "Smart contract wallets cannot deposit to Irys storage. Switch to a standard wallet (EOA) for upload.";
    case "deposit_pending":
      return "Your Irys storage deposit is still confirming. Wait a minute and try again — you will not be charged twice.";
    case "deposit_write_unavailable":
      return "Connect a wallet on a supported network to pay for storage.";
    case "deposit_send_failed":
      return "The Irys storage deposit transaction could not be sent. Try again.";
    case "deposit_landed_error":
      return "The Irys storage deposit transaction failed on-chain. Try again.";
    case "deposit_credit_short":
      return "The Irys deposit was submitted but storage balance is still too low. Wait a minute and try again.";
    case "deposit_unknown_token":
      return "Irys storage deposits are not configured for this payment token.";
    case "wallet_rejected":
      return walletRejectionCopy();
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

export class IrysDepositRefusal extends Error {
  readonly depositCause: IrysDepositCause;

  constructor(depositCause: IrysDepositCause, detail?: string) {
    super(detail ?? depositCause);
    this.name = "IrysDepositRefusal";
    this.depositCause = depositCause;
  }
}

export function isIrysDepositRefusal(err: unknown): err is IrysDepositRefusal {
  return err instanceof IrysDepositRefusal;
}

export function formatIrysUploadError(err: unknown): string {
  if (isWalletRejection(err)) {
    return walletRejectionCopy();
  }
  if (isIrysDepositRefusal(err)) {
    return irysDepositCauseCopy(err.depositCause);
  }
  return "Upload failed. Please try again.";
}

function refuse(
  cause: IrysDepositCause,
  detail?: string,
): IrysDepositResult {
  return detail != null ? { ok: false, cause, detail } : { ok: false, cause };
}

function evmMinConfirmationsForToken(token: string): number | null {
  if (token === "base-eth" || token === "ethereum") {
    return IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS;
  }
  return null;
}

function parseAtomicAmount(value: { toString: () => string }): bigint {
  const raw = value.toString();
  // Irys BigNumber may emit fixed decimals; take the integer part only.
  const intPart = raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw;
  if (!/^-?\d+$/.test(intPart)) {
    throw new IrysDepositRefusal("deposit_send_failed", `bad_amount:${raw}`);
  }
  return BigInt(intPart);
}

/** ceil((price − balance) × 11/10) in base units. */
function neededDepositAmount(price: bigint, balance: bigint): bigint {
  if (balance >= price) return 0n;
  const shortfall = price - balance;
  return (
    (shortfall * IRYS_DEPOSIT_AMOUNT_NUMERATOR +
      (IRYS_DEPOSIT_AMOUNT_DENOMINATOR - 1n)) /
    IRYS_DEPOSIT_AMOUNT_DENOMINATOR
  );
}

export async function waitIrysEvmDepositConfirmations(args: {
  chainId: number;
  txHash: `0x${string}`;
  minConfirmations: number;
}): Promise<void> {
  const client = getPublicClient(args.chainId);
  await client.waitForTransactionReceipt({ hash: args.txHash });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const confirmations = await client.getTransactionConfirmations({
      hash: args.txHash,
    });
    if (confirmations >= BigInt(args.minConfirmations)) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new IrysDepositRefusal("deposit_pending");
}

/**
 * EIP-1193 eth_sendTransaction port — product owns the transfer (not SDK fund).
 */
export function createIrysEvmDepositSendPortFromProvider(
  provider: unknown,
): IrysEvmDepositSendPort {
  if (
    provider == null ||
    typeof provider !== "object" ||
    !("request" in provider) ||
    typeof (provider as { request?: unknown }).request !== "function"
  ) {
    throw new IrysDepositRefusal(
      "deposit_send_failed",
      "No EIP-1193 wallet provider available",
    );
  }
  const eip1193 = provider as {
    request: (args: {
      method: string;
      params?: readonly unknown[];
    }) => Promise<unknown>;
  };
  return {
    async sendTransaction({ to, value, chainId }) {
      const accounts = (await eip1193.request({
        method: "eth_accounts",
      })) as string[];
      const from = accounts[0];
      if (from == null || from.length === 0) {
        throw new IrysDepositRefusal("deposit_send_failed", "no_connected_account");
      }
      const hash = await eip1193.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to,
            value: `0x${value.toString(16)}`,
            chainId: `0x${chainId.toString(16)}`,
          },
        ],
      });
      if (typeof hash !== "string" || !hash.startsWith("0x")) {
        throw new IrysDepositRefusal("deposit_send_failed", "no_tx_hash");
      }
      return hash as `0x${string}`;
    },
  };
}

async function resolveOpenRecord(args: {
  stack: CommercialActiveStack;
  uploader: IrysDepositUploader;
  record: IrysDepositRecord;
  key: string;
  store: IrysDepositRecordStore;
  ports: IrysDepositPorts;
  price: bigint;
  paymentToken: string;
  bundlerUrl: string;
}): Promise<IrysDepositResult> {
  const token = args.paymentToken;

  const balanceNow = parseAtomicAmount(await args.uploader.getBalance());
  if (balanceNow >= args.price) {
    clearIrysDepositRecord(args.store, args.key);
    return { ok: true };
  }

  if (args.stack.vm === "svm") {
    const heightRaw = args.record.lastValidBlockHeight;
    if (heightRaw == null || heightRaw.length === 0) {
      clearIrysDepositRecord(args.store, args.key);
      return refuse("deposit_pending", "missing_last_valid_block_height");
    }
    const confirm =
      args.ports.confirmSvmFunding ??
      createProductSvmFundingTxConfirmPort(args.stack);
    const outcome = await confirm.confirmSubmission({
      vm: "svm",
      signature: args.record.txId,
      lastValidBlockHeight: BigInt(heightRaw),
    });
    if (outcome.kind === "expired") {
      clearIrysDepositRecord(args.store, args.key);
      return refuse("deposit_pending", "expired");
    }
    if (outcome.kind === "landed_with_error") {
      clearIrysDepositRecord(args.store, args.key);
      return refuse("deposit_landed_error");
    }
    if (outcome.kind === "status_unknown") {
      return refuse("deposit_pending", "status_unknown");
    }
    // landed_ok at finalized → POST
  } else {
    const minConfirm = evmMinConfirmationsForToken(token);
    if (minConfirm == null) {
      return refuse("deposit_unknown_token", token);
    }
    const wait =
      args.ports.waitEvmConfirmations ?? waitIrysEvmDepositConfirmations;
    try {
      await wait({
        chainId: Number(args.stack.namespace),
        txHash: args.record.txId as `0x${string}`,
        minConfirmations: minConfirm,
      });
    } catch (err) {
      if (isWalletRejection(err)) return refuse("wallet_rejected");
      if (isIrysDepositRefusal(err)) return refuse(err.depositCause);
      return refuse("deposit_pending");
    }
  }

  const post =
    args.ports.postBundlerDeposit ??
    ((a: { bundlerUrl: string; token: string; txId: string }) =>
      postIrysBundlerDepositTx(a));
  const posted = await post({
    bundlerUrl: args.bundlerUrl.replace(/\/$/, ""),
    token,
    txId: args.record.txId,
  });
  if (posted.statusClass === "accepted") {
    clearIrysDepositRecord(args.store, args.key);
    const after = parseAtomicAmount(await args.uploader.getBalance());
    if (after >= args.price) return { ok: true };
    return refuse("deposit_credit_short");
  }
  // not_seen_yet / bundler_unavailable — keep record
  return refuse("deposit_pending", posted.statusClass);
}

async function sendNewDeposit(args: {
  stack: CommercialActiveStack;
  account: ActiveAccount;
  uploader: IrysDepositUploader;
  needed: bigint;
  key: string;
  store: IrysDepositRecordStore;
  ports: IrysDepositPorts;
  price: bigint;
  paymentToken: string;
  bundlerUrl: string;
}): Promise<IrysDepositResult> {
  const ns = Number(args.stack.namespace);
  const avail = txWriteAvailability(args.account, ns);
  if (!avail.available) {
    return refuse(
      "deposit_write_unavailable",
      txWriteRefusalMessage(avail as TxWriteUnavailable),
    );
  }

  if (!probeIrysDepositRecordStoreWritable(args.store)) {
    return refuse("deposit_record_unavailable");
  }

  const bundlerAddress = await args.uploader.utils.getBundlerAddress(
    args.paymentToken,
  );
  const amountBase = args.needed;

  let txId: string;
  let lastValidBlockHeight: string | undefined;

  try {
    if (args.stack.vm === "svm") {
      if (args.account.status !== "connected" || args.account.vm !== "svm") {
        return refuse("deposit_write_unavailable");
      }
      const port = args.ports.svmSignAndSend;
      if (port == null) {
        return refuse("deposit_send_failed", "missing_svm_port");
      }
      const sent = await sendSvmNativeTransfer({
        stack: args.stack,
        from: args.account.address,
        to: bundlerAddress,
        lamports: amountBase,
        port,
      });
      if (!sent.ok) {
        return refuse("deposit_send_failed", sent.cause);
      }
      txId = sent.submission.signature;
      lastValidBlockHeight = sent.submission.lastValidBlockHeight.toString();
    } else {
      if (args.account.status !== "connected" || args.account.vm !== "evm") {
        return refuse("deposit_write_unavailable");
      }
      const kindReader =
        args.ports.readEvmAccountKind ?? readAccountKind;
      const kind = await kindReader(
        Number(args.stack.namespace),
        args.account.address,
      );
      if (kind === "contract") {
        return refuse("deposit_contract_wallet");
      }
      if (evmMinConfirmationsForToken(args.paymentToken) == null) {
        return refuse("deposit_unknown_token", args.paymentToken);
      }
      const sendPort = args.ports.sendEvmTransaction;
      if (sendPort == null) {
        return refuse("deposit_send_failed", "missing_evm_port");
      }
      txId = await sendPort.sendTransaction({
        to: bundlerAddress as `0x${string}`,
        value: amountBase,
        chainId: Number(args.stack.namespace),
      });
    }
  } catch (err) {
    if (isWalletRejection(err)) return refuse("wallet_rejected");
    if (isIrysDepositRefusal(err)) return refuse(err.depositCause);
    return refuse(
      "deposit_send_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  const record: IrysDepositRecord = {
    txId,
    amountBaseUnits: amountBase.toString(),
    createdAt: Date.now(),
    ...(lastValidBlockHeight != null ? { lastValidBlockHeight } : {}),
  };
  if (!writeIrysDepositRecord(args.store, args.key, record)) {
    return refuse("deposit_record_unavailable");
  }

  return resolveOpenRecord({
    stack: args.stack,
    uploader: args.uploader,
    record,
    key: args.key,
    store: args.store,
    ports: args.ports,
    price: args.price,
    paymentToken: args.paymentToken,
    bundlerUrl: args.bundlerUrl,
  });
}

/**
 * Ensure the uploader's Irys balance covers `totalBytes` (after estimate overhead).
 * Balance-first; resolve open pending record before any new pay; never double-pay.
 */
export async function ensureIrysDeposit(args: {
  stack: CommercialActiveStack;
  account: ActiveAccount;
  uploader: IrysDepositUploader;
  totalBytes: number;
  paymentToken: string;
  bundlerUrl: string;
  ports?: IrysDepositPorts;
}): Promise<IrysDepositResult> {
  const ports = args.ports ?? {};
  const store = ports.store ?? createLocalStorageIrysDepositRecordStore();
  const bytes = estimateIrysUploadBytes(args.totalBytes);
  const price = parseAtomicAmount(await args.uploader.getPrice(bytes));
  const balance = parseAtomicAmount(await args.uploader.getBalance());

  const bundlerAddress = await args.uploader.utils.getBundlerAddress(
    args.paymentToken,
  );
  const payer =
    args.account.status === "connected" ? args.account.address : "";
  const key = irysDepositRecordKey({
    namespace: Number(args.stack.namespace),
    payer,
    bundlerAddress,
  });

  if (balance >= price) {
    clearIrysDepositRecord(store, key);
    return { ok: true };
  }

  const open = readIrysDepositRecord(store, key);
  if (open != null) {
    return resolveOpenRecord({
      stack: args.stack,
      uploader: args.uploader,
      record: open,
      key,
      store,
      ports,
      price,
      paymentToken: args.paymentToken,
      bundlerUrl: args.bundlerUrl,
    });
  }

  const needed = neededDepositAmount(price, balance);
  if (needed <= 0n) {
    return { ok: true };
  }

  return sendNewDeposit({
    stack: args.stack,
    account: args.account,
    uploader: args.uploader,
    needed,
    key,
    store,
    ports,
    price,
    paymentToken: args.paymentToken,
    bundlerUrl: args.bundlerUrl,
  });
}

/**
 * Build deposit ports from a resolved upload session (no VM fork in chrome).
 */
export function buildIrysDepositPorts(args: {
  stack: CommercialActiveStack;
  provider: unknown;
  svmWallet?: Wallet | null;
}): IrysDepositPorts {
  if (args.stack.vm === "svm") {
    if (args.svmWallet == null) {
      return {};
    }
    const bound = createSvmSignAndSendPort(args.svmWallet);
    if (!bound.ok) {
      return {};
    }
    return {
      svmSignAndSend: bound.port,
      confirmSvmFunding: createProductSvmFundingTxConfirmPort(
        args.stack as SvmCommercialActiveStack,
      ),
    };
  }
  return {
    sendEvmTransaction: createIrysEvmDepositSendPortFromProvider(args.provider),
    waitEvmConfirmations: waitIrysEvmDepositConfirmations,
  };
}

/** @internal test seam — deposit amount math. */
export function irysDepositNeededAmountForTests(
  price: string,
  balance: string,
): string {
  return neededDepositAmount(BigInt(price), BigInt(balance)).toString();
}

export type { IrysPaymentToken };
