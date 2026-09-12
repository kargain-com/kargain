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
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";

import {
  walletStandardChainOf,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import {
  fetchProductSvmLatestBlockhash,
  type FetchSvmLatestBlockhashResult,
} from "@/lib/web3/svm-rpc";
import type { WalletStandardChain } from "@/lib/web3/wallet-standard-chain";

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
  | "wallet_returned_no_signature"
  | "blockhash_unavailable"
  | "blockhash_expired"
  | "unregistered_program"
  | "empty_instruction_data"
  | "missing_wallet_standard_chain";

export type SendSvmInstructionResult =
  | { ok: true; signature: string }
  | {
      ok: false;
      cause: SendSvmInstructionCause;
      detail: string;
    };

export type SvmWriteAccountMeta = {
  address: string;
  role: AccountRole;
};

/** Commercial program fields that may appear as instruction program ids. */
const SVM_WRITE_PROGRAM_FIELDS = [
  "karPassport",
  "karProPass",
  "karProStaking",
  "bridgeGateway",
  "fixedPriceConsignment",
  "ascendingConsignment",
] as const satisfies readonly (keyof SvmCommercialActiveStack)[];

function isRegisteredProgramOnStack(
  stack: SvmCommercialActiveStack,
  programId: string,
): boolean {
  for (const field of SVM_WRITE_PROGRAM_FIELDS) {
    const value = stack[field];
    if (typeof value === "string" && value === programId) {
      return true;
    }
  }
  return false;
}

function refuse(
  cause: SendSvmInstructionCause,
  detail: string,
): SendSvmInstructionResult {
  return { ok: false, cause, detail };
}

/**
 * Assemble one instruction into a transaction, sign-and-send via the port,
 * return the base58 signature expected by {@link runSvmWriteLifecycle}.
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
  if (args.data.byteLength === 0) {
    return refuse("empty_instruction_data", "instruction data is empty");
  }
  if (!args.feePayer || args.feePayer.trim().length === 0) {
    return refuse("no_connected_account", "fee payer address is empty");
  }
  if (!isRegisteredProgramOnStack(args.stack, args.programId)) {
    return refuse("unregistered_program", args.programId);
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
    const messageText = err instanceof Error ? err.message : String(err);
    if (
      messageText.includes("solana:signAndSendTransaction") ||
      messageText.includes("wallet_cannot_sign_and_send")
    ) {
      return refuse("wallet_cannot_sign_and_send", messageText);
    }
    if (
      messageText.includes("no connected account") ||
      messageText.includes("no_connected_account")
    ) {
      return refuse("no_connected_account", messageText);
    }
    return refuse("wallet_cannot_sign_and_send", messageText);
  }

  if (signatureBytes == null || signatureBytes.byteLength === 0) {
    return refuse("wallet_returned_no_signature", "wallet returned no signature");
  }

  const signature = getBase58Decoder().decode(signatureBytes);
  if (signature.length === 0) {
    return refuse("wallet_returned_no_signature", "base58 signature is empty");
  }

  return { ok: true, signature };
}
