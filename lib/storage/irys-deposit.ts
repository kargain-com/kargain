/**
 * Sole Irys storage-deposit owner — balance-first, pending-record, no SDK fund().
 *
 * Never uses `runTx` (Irys transfers are invisible to indexer sync).
 * Never calls `uploader.fund` / `submitFundTransaction`.
 * EVM send/switch/confirm come only from injected ports (hook → wagmi adapters).
 */

import type { Wallet } from "@wallet-standard/base";
import { getAddress, isAddress } from "viem";

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
  evmSwitchChainAvailability,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import {
  type CommercialActiveStack,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import type { EvmDepositConfirmOutcome } from "@/lib/web3/evm-tx-confirm";
import { createProductSvmFundingTxConfirmPort } from "@/lib/web3/svm-rpc";
import {
  sendSvmNativeTransfer,
  type SvmSignAndSendPort,
} from "@/lib/web3/svm-write-adapter";
import { createSvmSignAndSendPort } from "@/lib/web3/svm-sign-and-send-port";
import type { SvmTxConfirmPort } from "@/lib/web3/svm-tx-confirm";
import {
  txWriteAvailability,
  txWriteGuardRefusalCopy,
  type TxWriteGuardPayload,
} from "@/lib/web3/tx-write-availability";
import {
  isWalletRejection,
  walletRejectionCopy,
} from "@/lib/web3/wallet-rejection";
import {
  readAccountKind,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";
import { shortAddress } from "@/lib/web3/wallet-display";

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
  /**
   * Opaque Irys token config. Runtime path: `tokenConfig.minConfirm`
   * (BaseWebToken default 5 for base-eth/ethereum). Not typed against WebToken —
   * that interface omits minConfirm even though BaseWebToken declares it.
   */
  tokenConfig?: unknown;
};

/**
 * Runtime minConfirm from Irys token config.
 * Path: `uploader.tokenConfig.minConfirm` (BaseWebToken default 5 for base-eth/ethereum).
 */
export function readIrysEvmMinConfirm(
  uploader: IrysDepositUploader,
): number | null {
  const cfg = uploader.tokenConfig;
  if (cfg == null || typeof cfg !== "object") return null;
  const raw = (cfg as { minConfirm?: unknown }).minConfirm;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return null;
  }
  return raw;
}

export type IrysDepositCause =
  | "deposit_record_unavailable"
  | "deposit_record_unreadable"
  | "deposit_cancelled"
  | "deposit_contract_wallet"
  | "deposit_pending"
  | "deposit_expired"
  | "deposit_write_unavailable"
  | "deposit_send_failed"
  | "deposit_landed_error"
  | "deposit_credit_short"
  | "deposit_unknown_token"
  | "wallet_rejected";

export type IrysDepositResult =
  | { ok: true }
  | {
      ok: false;
      cause: IrysDepositCause;
      /** Machine detail only — never a user sentence. */
      detail?: string;
      /** Typed write/switch guard when cause is deposit_write_unavailable. */
      guard?: TxWriteGuardPayload;
      /** Shown truncated in deposit_record_unreadable copy when present. */
      txId?: string;
    };

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
  /** EVM native send — required for EVM; built from useEvmSendTransaction only. */
  sendEvmTransaction?: IrysEvmDepositSendPort;
  /** EVM chain switch — required when wallet chain ≠ stack. */
  switchChain?: (chainId: number) => Promise<void>;
  /** Override account-kind reader (defaults to {@link readAccountKind}). */
  readEvmAccountKind?: (
    chainId: number,
    address: `0x${string}`,
  ) => Promise<WalletAccountKind>;
  /** Injectable SVM funding confirm (defaults to product finalized port). */
  confirmSvmFunding?: SvmTxConfirmPort;
  /**
   * EVM confirmations wait — wraps {@link confirmEvmTransactionConfirmations}.
   * Required for EVM resolve; no default in product (hook injects).
   * Returns typed outcome (final hash / cancelled / diverted / timeout).
   */
  waitEvmConfirmations?: (args: {
    txHash: `0x${string}`;
    minConfirmations: number;
    expectedTo: `0x${string}`;
    chainId: number;
  }) => Promise<EvmDepositConfirmOutcome>;
  /** Injectable bundler POST (defaults to {@link postIrysBundlerDepositTx}). */
  postBundlerDeposit?: (args: {
    bundlerUrl: string;
    token: string;
    txId: string;
  }) => Promise<{ statusClass: IrysBundlerDepositPostClass; httpStatus: number }>;
  store?: IrysDepositRecordStore;
};

export function irysDepositCauseCopy(
  cause: IrysDepositCause,
  opts?: { txId?: string },
): string {
  switch (cause) {
    case "deposit_record_unavailable":
      return "Storage deposit could not be tracked in this browser. Enable site storage and try again.";
    case "deposit_record_unreadable": {
      if (opts?.txId != null && opts.txId.length > 0) {
        return `The previous storage deposit's status cannot be read. Contact support with transaction ${shortAddress(opts.txId)}. Do not deposit again until this is resolved.`;
      }
      return "The previous storage deposit's status cannot be read. Contact support. Do not deposit again until this is resolved.";
    }
    case "deposit_cancelled":
      return "The previous storage deposit was cancelled or replaced in the wallet. Nothing was sent to storage. Try again.";
    case "deposit_contract_wallet":
      return "Smart contract wallets cannot deposit to Irys storage. Switch to a standard wallet (EOA) for upload.";
    case "deposit_pending":
      return "Your Irys storage deposit is still confirming. Wait a minute and try again — you will not be charged twice.";
    case "deposit_expired":
      return "The previous storage deposit did not land. Nothing was charged except the network fee. Try again.";
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
  readonly guard?: TxWriteGuardPayload;
  readonly txId?: string;

  constructor(
    depositCause: IrysDepositCause,
    opts?: { detail?: string; guard?: TxWriteGuardPayload; txId?: string },
  ) {
    super(opts?.detail ?? depositCause);
    this.name = "IrysDepositRefusal";
    this.depositCause = depositCause;
    if (opts?.guard != null) this.guard = opts.guard;
    if (opts?.txId != null) this.txId = opts.txId;
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
    if (
      err.depositCause === "deposit_write_unavailable" &&
      err.guard != null
    ) {
      return txWriteGuardRefusalCopy(err.guard);
    }
    return irysDepositCauseCopy(err.depositCause, { txId: err.txId });
  }
  return "Upload failed. Please try again.";
}

function refuse(
  cause: IrysDepositCause,
  opts?: { detail?: string; guard?: TxWriteGuardPayload; txId?: string },
): IrysDepositResult {
  return {
    ok: false,
    cause,
    ...(opts?.detail != null ? { detail: opts.detail } : {}),
    ...(opts?.guard != null ? { guard: opts.guard } : {}),
    ...(opts?.txId != null ? { txId: opts.txId } : {}),
  };
}

function parseAtomicAmount(value: { toString: () => string }): bigint {
  const raw = value.toString();
  const intPart = raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw;
  if (!/^-?\d+$/.test(intPart)) {
    throw new IrysDepositRefusal("deposit_send_failed", {
      detail: `bad_amount:${raw}`,
    });
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

function recordTxId(record: IrysDepositRecord): string {
  return record.vm === "evm" ? record.txHash : record.signature;
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
  bundlerAddress: string;
}): Promise<IrysDepositResult> {
  const balanceNow = parseAtomicAmount(await args.uploader.getBalance());
  if (balanceNow >= args.price) {
    clearIrysDepositRecord(args.store, args.key);
    return { ok: true };
  }

  let postTxId = recordTxId(args.record);

  if (args.stack.vm === "svm") {
    if (args.record.vm !== "svm") {
      return refuse("deposit_record_unreadable");
    }
    const confirm =
      args.ports.confirmSvmFunding ??
      createProductSvmFundingTxConfirmPort(args.stack);
    const outcome = await confirm.confirmSubmission({
      vm: "svm",
      signature: args.record.signature,
      lastValidBlockHeight: BigInt(args.record.lastValidBlockHeight),
    });
    if (outcome.kind === "expired") {
      clearIrysDepositRecord(args.store, args.key);
      return refuse("deposit_expired");
    }
    if (outcome.kind === "landed_with_error") {
      clearIrysDepositRecord(args.store, args.key);
      return refuse("deposit_landed_error");
    }
    if (outcome.kind === "status_unknown") {
      return refuse("deposit_pending", { detail: "status_unknown" });
    }
    // landed_ok at finalized → POST
  } else {
    if (args.record.vm !== "evm") {
      return refuse("deposit_record_unreadable");
    }
    const minConfirm = readIrysEvmMinConfirm(args.uploader);
    if (minConfirm == null) {
      return refuse("deposit_unknown_token");
    }
    if (!isAddress(args.bundlerAddress)) {
      return refuse("deposit_send_failed", {
        detail: "bundler_address_unusable",
      });
    }
    const expectedTo = getAddress(args.bundlerAddress);
    const wait = args.ports.waitEvmConfirmations;
    if (wait == null) {
      return refuse("deposit_send_failed", { detail: "missing_evm_confirm_port" });
    }
    let outcome: EvmDepositConfirmOutcome;
    try {
      outcome = await wait({
        txHash: args.record.txHash,
        minConfirmations: minConfirm,
        expectedTo,
        chainId: Number(args.stack.namespace),
      });
    } catch (err) {
      if (isWalletRejection(err)) return refuse("wallet_rejected");
      if (isIrysDepositRefusal(err)) {
        return refuse(err.depositCause, {
          detail: err.message,
          guard: err.guard,
          txId: err.txId,
        });
      }
      return refuse("deposit_pending");
    }
    if (outcome.kind === "cancelled" || outcome.kind === "diverted") {
      clearIrysDepositRecord(args.store, args.key);
      return refuse("deposit_cancelled");
    }
    if (outcome.kind === "timeout") {
      return refuse("deposit_pending", { detail: "evm_confirmations_timeout" });
    }
    postTxId = outcome.hash;
    if (outcome.hash !== args.record.txHash) {
      const rewritten: IrysDepositRecord = {
        vm: "evm",
        txHash: outcome.hash,
        amountBaseUnits: args.record.amountBaseUnits,
        createdAt: args.record.createdAt,
      };
      if (!writeIrysDepositRecord(args.store, args.key, rewritten)) {
        return refuse("deposit_record_unavailable");
      }
    }
  }

  const post =
    args.ports.postBundlerDeposit ??
    ((a: { bundlerUrl: string; token: string; txId: string }) =>
      postIrysBundlerDepositTx(a));
  const posted = await post({
    bundlerUrl: args.bundlerUrl.replace(/\/$/, ""),
    token: args.paymentToken,
    txId: postTxId,
  });
  if (posted.statusClass === "accepted") {
    clearIrysDepositRecord(args.store, args.key);
    const after = parseAtomicAmount(await args.uploader.getBalance());
    if (after >= args.price) return { ok: true };
    return refuse("deposit_credit_short");
  }
  return refuse("deposit_pending", { detail: posted.statusClass });
}

async function sendNewDeposit(args: {
  stack: CommercialActiveStack;
  account: ActiveAccount & { status: "connected" };
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
    return refuse("deposit_write_unavailable", {
      guard: { guard: "write_availability", refusal: avail },
    });
  }

  if (!probeIrysDepositRecordStoreWritable(args.store)) {
    return refuse("deposit_record_unavailable");
  }

  const bundlerAddress = await args.uploader.utils.getBundlerAddress(
    args.paymentToken,
  );
  const amountBase = args.needed;

  let record: IrysDepositRecord;

  try {
    if (args.stack.vm === "svm") {
      if (args.account.vm !== "svm") {
        return refuse("deposit_write_unavailable", {
          guard: {
            guard: "write_availability",
            refusal: { available: false, cause: "wrong_vm", wanted: "svm" },
          },
        });
      }
      const port = args.ports.svmSignAndSend;
      if (port == null) {
        return refuse("deposit_send_failed", { detail: "missing_svm_port" });
      }
      const sent = await sendSvmNativeTransfer({
        stack: args.stack,
        from: args.account.address,
        to: bundlerAddress,
        lamports: amountBase,
        port,
      });
      if (!sent.ok) {
        return refuse("deposit_send_failed", { detail: sent.cause });
      }
      record = {
        vm: "svm",
        signature: sent.submission.signature,
        lastValidBlockHeight: sent.submission.lastValidBlockHeight.toString(),
        amountBaseUnits: amountBase.toString(),
        createdAt: Date.now(),
      };
    } else {
      if (args.account.vm !== "evm" || avail.vm !== "evm") {
        return refuse("deposit_write_unavailable", {
          guard: {
            guard: "write_availability",
            refusal: { available: false, cause: "wrong_vm", wanted: "evm" },
          },
        });
      }
      if (avail.walletChainId !== ns) {
        const switchAvail = evmSwitchChainAvailability(args.account);
        if (!switchAvail.available) {
          return refuse("deposit_write_unavailable", {
            guard: { guard: "switch_chain", refusal: switchAvail },
          });
        }
        const switchFn = args.ports.switchChain;
        if (switchFn == null) {
          return refuse("deposit_send_failed", {
            detail: "missing_switch_chain_port",
          });
        }
        await switchFn(ns);
      }

      const kindReader = args.ports.readEvmAccountKind ?? readAccountKind;
      const kind = await kindReader(ns, args.account.address);
      if (kind === "contract") {
        return refuse("deposit_contract_wallet");
      }
      if (readIrysEvmMinConfirm(args.uploader) == null) {
        return refuse("deposit_unknown_token");
      }
      const sendPort = args.ports.sendEvmTransaction;
      if (sendPort == null) {
        return refuse("deposit_send_failed", { detail: "missing_evm_port" });
      }
      if (!isAddress(bundlerAddress)) {
        return refuse("deposit_send_failed", {
          detail: "bundler_address_unusable",
        });
      }
      const txHash = await sendPort.sendTransaction({
        to: getAddress(bundlerAddress),
        value: amountBase,
        chainId: ns,
      });
      record = {
        vm: "evm",
        txHash,
        amountBaseUnits: amountBase.toString(),
        createdAt: Date.now(),
      };
    }
  } catch (err) {
    if (isWalletRejection(err)) return refuse("wallet_rejected");
    if (isIrysDepositRefusal(err)) {
      return refuse(err.depositCause, {
        detail: err.message,
        guard: err.guard,
        txId: err.txId,
      });
    }
    return refuse("deposit_send_failed", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

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
    bundlerAddress,
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
  if (args.account.status !== "connected") {
    return refuse("deposit_write_unavailable", {
      guard: {
        guard: "write_availability",
        refusal: { available: false, cause: "disconnected" },
      },
    });
  }

  const ports = args.ports ?? {};
  const store = ports.store ?? createLocalStorageIrysDepositRecordStore();
  const bytes = estimateIrysUploadBytes(args.totalBytes);
  const price = parseAtomicAmount(await args.uploader.getPrice(bytes));
  const balance = parseAtomicAmount(await args.uploader.getBalance());

  const bundlerAddress = await args.uploader.utils.getBundlerAddress(
    args.paymentToken,
  );
  const key = irysDepositRecordKey({
    namespace: Number(args.stack.namespace),
    payer: args.account.address,
    bundlerAddress,
  });

  if (balance >= price) {
    clearIrysDepositRecord(store, key);
    return { ok: true };
  }

  const open = readIrysDepositRecord(store, key, args.stack.vm);
  if (open.kind === "unreadable") {
    return refuse("deposit_record_unreadable");
  }
  if (open.kind === "record") {
    return resolveOpenRecord({
      stack: args.stack,
      uploader: args.uploader,
      record: open.record,
      key,
      store,
      ports,
      price,
      paymentToken: args.paymentToken,
      bundlerUrl: args.bundlerUrl,
      bundlerAddress,
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
 * SVM-only default ports. EVM send/switch/confirm must come from the hook owner.
 */
export function buildIrysDepositPorts(args: {
  stack: CommercialActiveStack;
  svmWallet?: Wallet | null;
}): IrysDepositPorts {
  if (args.stack.vm !== "svm") {
    return {};
  }
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

export type { IrysPaymentToken };
