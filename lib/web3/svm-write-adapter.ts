/**
 * Sole product owner: assembled SVM instruction → base58 signature.
 *
 * Does not encode instructions, derive PDAs, or choose account metas.
 * Assembles with `@solana/kit`, attaches blockhash from `svm-rpc`, and calls
 * an injected {@link SvmSignAndSendPort} (`solana:signAndSendTransaction` only).
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash as assertBlockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";

import {
  svmKargainProgramIds,
  walletStandardChainOf,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { encodeSystemTransfer } from "@/lib/svm/encode-system-transfer";
import { systemProgramId } from "@/lib/svm/foreign-programs";
import {
  fetchProductSvmLatestBlockhash,
  type FetchSvmLatestBlockhashResult,
} from "@/lib/web3/svm-rpc";
import { isWalletRejection } from "@/lib/web3/wallet-rejection";
import type { WalletStandardChain } from "@/lib/web3/wallet-standard-chain";
import type { SvmWriteSubmission } from "@/lib/web3/write-outcome";

export { AccountRole };

export type SvmSignAndSendPort = {
  signAndSendTransaction: (input: {
    transaction: Uint8Array;
    chain: WalletStandardChain;
  }) => Promise<Uint8Array>;
};

export type SendSvmInstructionCause =
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "wallet_rejected"
  | "wallet_send_failed"
  | "wallet_returned_no_signature"
  | "signature_not_64_bytes"
  | "blockhash_unavailable"
  | "blockhash_expired"
  | "unregistered_program"
  | "empty_instruction_data"
  | "missing_wallet_standard_chain";

export type SendSvmInstructionResult =
  | { ok: true; submission: SvmWriteSubmission }
  | {
      ok: false;
      cause: Exclude<SendSvmInstructionCause, "wallet_send_failed">;
      detail: string;
    }
  | {
      ok: false;
      cause: "wallet_send_failed";
      error: unknown;
    };

/** Ed25519 signature length returned by Wallet Standard `signAndSendTransaction`. */
export const WALLET_STANDARD_SIGNATURE_BYTE_LENGTH = 64;

export type WalletStandardSignatureBase58Cause =
  | "wallet_returned_no_signature"
  | "signature_not_64_bytes";

export type WalletStandardSignatureBase58Result =
  | { ok: true; signature: string }
  | { ok: false; cause: WalletStandardSignatureBase58Cause };

/**
 * Sole product conversion: Wallet Standard signature bytes → base58 tx id.
 * Kit decoder only — never a hand-rolled alphabet loop.
 */
export function walletStandardSignatureBase58(
  signatureBytes: Uint8Array | null | undefined,
): WalletStandardSignatureBase58Result {
  if (signatureBytes == null || signatureBytes.byteLength === 0) {
    return { ok: false, cause: "wallet_returned_no_signature" };
  }
  if (signatureBytes.byteLength !== WALLET_STANDARD_SIGNATURE_BYTE_LENGTH) {
    return { ok: false, cause: "signature_not_64_bytes" };
  }
  const signature = getBase58Decoder().decode(signatureBytes);
  if (signature.length === 0) {
    return { ok: false, cause: "wallet_returned_no_signature" };
  }
  return { ok: true, signature };
}

/**
 * Stored base58 string → true iff kit encodes to exactly 64 Ed25519 bytes.
 * Deposit-record reader consumes this — never imports kit itself.
 */
export function isWalletStandardSignatureBase58(signature: string): boolean {
  try {
    const bytes = getBase58Encoder().encode(signature);
    return bytes.byteLength === WALLET_STANDARD_SIGNATURE_BYTE_LENGTH;
  } catch {
    return false;
  }
}

export type SvmWriteAccountMeta = {
  address: string;
  role: AccountRole;
};

function isRegisteredProgramOnStack(
  stack: SvmCommercialActiveStack,
  programId: string,
): boolean {
  return svmKargainProgramIds(stack).includes(programId);
}

function refuse(
  cause: Exclude<SendSvmInstructionCause, "wallet_send_failed">,
  detail: string,
): SendSvmInstructionResult {
  return { ok: false, cause, detail };
}

/**
 * Shared assemble → sign-and-send — used by commercial instruction sends and
 * System native transfers. Caller owns the program-id admission gate.
 */
async function assembleSignAndSendSvmInstruction(args: {
  stack: SvmCommercialActiveStack;
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  port: SvmSignAndSendPort;
  fetchBlockhash?: () => Promise<FetchSvmLatestBlockhashResult>;
}): Promise<SendSvmInstructionResult> {
  if (args.data.byteLength === 0) {
    return refuse("empty_instruction_data", "instruction data is empty");
  }
  if (!args.feePayer || args.feePayer.trim().length === 0) {
    return refuse("no_connected_account", "fee payer address is empty");
  }

  const chainResult = walletStandardChainOf(args.stack);
  if (!chainResult.ok) {
    return refuse("missing_wallet_standard_chain", chainResult.detail);
  }

  const fetchBlockhash =
    args.fetchBlockhash ?? (() => fetchProductSvmLatestBlockhash());
  const blockhashResult = await fetchBlockhash();
  if (!blockhashResult.ok) {
    return refuse(blockhashResult.cause, blockhashResult.detail);
  }

  let feePayer: Address;
  let programAddress: Address;
  try {
    feePayer = address(args.feePayer);
    programAddress = address(args.programId);
  } catch (err) {
    return refuse(
      "unregistered_program",
      err instanceof Error ? err.message : String(err),
    );
  }

  const accountMetas: { address: Address; role: AccountRole }[] = [];
  for (const meta of args.accounts) {
    try {
      accountMetas.push({
        address: address(meta.address),
        role: meta.role,
      });
    } catch (err) {
      return refuse(
        "unregistered_program",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  let lifetimeBlockhash;
  try {
    lifetimeBlockhash = assertBlockhash(blockhashResult.value.blockhash);
  } catch (err) {
    return refuse(
      "blockhash_unavailable",
      err instanceof Error ? err.message : String(err),
    );
  }

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: lifetimeBlockhash,
          lastValidBlockHeight: blockhashResult.value.lastValidBlockHeight,
        },
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress,
          accounts: accountMetas,
          data: args.data,
        },
        m,
      ),
  );

  const compiled = compileTransaction(message);
  const wireBytes = new Uint8Array(getTransactionEncoder().encode(compiled));

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = await args.port.signAndSendTransaction({
      transaction: wireBytes,
      chain: chainResult.chain,
    });
  } catch (err) {
    if (isWalletRejection(err)) {
      return refuse("wallet_rejected", "wallet_rejected");
    }
    return { ok: false, cause: "wallet_send_failed", error: err };
  }

  const decoded = walletStandardSignatureBase58(signatureBytes);
  if (!decoded.ok) {
    return refuse(
      decoded.cause,
      decoded.cause === "signature_not_64_bytes"
        ? `wallet signature is ${signatureBytes?.byteLength ?? 0} bytes, expected ${WALLET_STANDARD_SIGNATURE_BYTE_LENGTH}`
        : "wallet returned no signature",
    );
  }

  const submission: SvmWriteSubmission = {
    vm: "svm",
    signature: decoded.signature,
    lastValidBlockHeight: blockhashResult.value.lastValidBlockHeight,
  };
  return { ok: true, submission };
}

/**
 * Assemble one commercial Kargain instruction into a transaction, sign-and-send
 * via the port, return the base58 signature expected by {@link runSvmWriteLifecycle}.
 * System program is refused (`unregistered_program`) — use {@link sendSvmNativeTransfer}.
 */
export async function sendSvmInstruction(args: {
  stack: SvmCommercialActiveStack;
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  port: SvmSignAndSendPort;
  fetchBlockhash?: () => Promise<FetchSvmLatestBlockhashResult>;
}): Promise<SendSvmInstructionResult> {
  if (!isRegisteredProgramOnStack(args.stack, args.programId)) {
    return refuse("unregistered_program", args.programId);
  }
  return assembleSignAndSendSvmInstruction(args);
}

export type SendSvmNativeTransferCause =
  | SendSvmInstructionCause
  | "lamports_zero"
  | "lamports_not_u64";

export type SendSvmNativeTransferResult =
  | { ok: true; submission: SvmWriteSubmission }
  | {
      ok: false;
      cause: Exclude<SendSvmNativeTransferCause, "wallet_send_failed">;
      detail: string;
    }
  | {
      ok: false;
      cause: "wallet_send_failed";
      error: unknown;
    };

/**
 * System-program Transfer (payer → recipient, lamports). Sibling of
 * {@link sendSvmInstruction} — shares port/blockhash/signature conversion.
 * Not admitted through the Kargain program gate.
 */
export async function sendSvmNativeTransfer(args: {
  stack: SvmCommercialActiveStack;
  from: string;
  to: string;
  lamports: bigint;
  port: SvmSignAndSendPort;
  fetchBlockhash?: () => Promise<FetchSvmLatestBlockhashResult>;
}): Promise<SendSvmNativeTransferResult> {
  const encoded = encodeSystemTransfer(args.lamports);
  if (!encoded.ok) {
    return { ok: false, cause: encoded.cause, detail: encoded.cause };
  }
  return assembleSignAndSendSvmInstruction({
    stack: args.stack,
    programId: systemProgramId(),
    data: encoded.data,
    accounts: [
      { address: args.from, role: AccountRole.WRITABLE_SIGNER },
      { address: args.to, role: AccountRole.WRITABLE },
    ],
    feePayer: args.from,
    port: args.port,
    fetchBlockhash: args.fetchBlockhash,
  });
}
