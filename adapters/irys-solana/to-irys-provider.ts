/**
 * Wallet Standard → Irys Solana provider (`MessageSignerWalletAdapter` shape).
 *
 * Product code must never import `@solana/web3.js`; this adapter owns the bridge.
 * Already-shaped providers (tests / wallet-adapter) pass through unchanged.
 * Signature bytes → base58 via the sole product owner in svm-write-adapter.
 */
import {
  PublicKey,
  type Connection,
  type Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

import type { IrysUploadPlan } from "@/lib/storage/irys-upload-plan";
import {
  walletStandardSignatureBase58,
  type WalletStandardSignatureBase58Cause,
} from "@/lib/web3/svm-write-adapter";

const SOLANA_SIGN_AND_SEND = "solana:signAndSendTransaction";
const SOLANA_SIGN_MESSAGE = "solana:signMessage";

/**
 * Typed refusal when Wallet Standard signature bytes cannot become a tx id.
 * Discriminant is {@link signatureCause} — never a guessed user sentence.
 */
export class IrysSolanaSignatureRefusalError extends Error {
  readonly signatureCause: WalletStandardSignatureBase58Cause;

  constructor(signatureCause: WalletStandardSignatureBase58Cause) {
    super(signatureCause);
    this.name = "IrysSolanaSignatureRefusalError";
    this.signatureCause = signatureCause;
  }
}

export type IrysSolanaWalletProvider = {
  publicKey: PublicKey;
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: { skipPreflight?: boolean },
  ) => Promise<TransactionSignature>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
};

type SignAndSendFeature = {
  signAndSendTransaction: (
    ...inputs: readonly {
      account: WalletAccount;
      chain: `${string}:${string}`;
      transaction: Uint8Array;
      options?: { skipPreflight?: boolean };
    }[]
  ) => Promise<readonly { signature: Uint8Array }[]>;
};

type SignMessageFeature = {
  signMessage: (
    ...inputs: readonly { account: WalletAccount; message: Uint8Array }[]
  ) => Promise<readonly { signature: Uint8Array }[]>;
};

function isIrysSolanaWalletProvider(
  value: unknown,
): value is IrysSolanaWalletProvider {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const publicKey = candidate.publicKey;
  return (
    publicKey != null &&
    typeof publicKey === "object" &&
    typeof (publicKey as { toBuffer?: unknown }).toBuffer === "function" &&
    typeof candidate.sendTransaction === "function" &&
    typeof candidate.signMessage === "function"
  );
}

function isWalletStandard(value: unknown): value is Wallet {
  return (
    value != null &&
    typeof value === "object" &&
    "features" in value &&
    "accounts" in value &&
    Array.isArray((value as Wallet).accounts)
  );
}

function solanaChainForPlan(plan: IrysUploadPlan): `${string}:${string}` {
  return plan.devnet ? "solana:devnet" : "solana:mainnet";
}

function primaryAccount(wallet: Wallet): WalletAccount {
  const account = wallet.accounts[0];
  if (account == null) {
    throw new Error("Solana wallet has no connected account");
  }
  return account;
}

function wrapWalletStandard(
  wallet: Wallet,
  plan: IrysUploadPlan,
): IrysSolanaWalletProvider {
  const account = primaryAccount(wallet);
  const publicKey = new PublicKey(account.address);
  const chain = solanaChainForPlan(plan);

  const signAndSend = wallet.features[SOLANA_SIGN_AND_SEND] as
    | SignAndSendFeature
    | undefined;
  if (signAndSend == null || typeof signAndSend.signAndSendTransaction !== "function") {
    throw new Error(
      `Wallet ${wallet.name} does not support solana:signAndSendTransaction`,
    );
  }

  const signMessageFeature = wallet.features[SOLANA_SIGN_MESSAGE] as
    | SignMessageFeature
    | undefined;
  if (
    signMessageFeature == null ||
    typeof signMessageFeature.signMessage !== "function"
  ) {
    throw new Error(`Wallet ${wallet.name} does not support solana:signMessage`);
  }

  return {
    publicKey,
    async sendTransaction(transaction, _connection, options) {
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const [output] = await signAndSend.signAndSendTransaction({
        account,
        chain,
        transaction: serialized,
        options: {
          skipPreflight: options?.skipPreflight,
        },
      });
      if (output == null) {
        throw new IrysSolanaSignatureRefusalError("wallet_returned_no_signature");
      }
      const decoded = walletStandardSignatureBase58(output.signature);
      if (!decoded.ok) {
        throw new IrysSolanaSignatureRefusalError(decoded.cause);
      }
      return decoded.signature;
    },
    async signMessage(message) {
      const [output] = await signMessageFeature.signMessage({
        account,
        message,
      });
      if (output == null) {
        throw new Error("Wallet returned no message signature");
      }
      return output.signature;
    },
  };
}

/**
 * Resolve an Irys-compatible Solana wallet provider from either a Wallet Standard
 * wallet or an already MessageSigner-shaped object.
 */
export function toIrysSolanaProvider(
  provider: unknown,
  plan: IrysUploadPlan,
): IrysSolanaWalletProvider {
  if (isIrysSolanaWalletProvider(provider)) {
    return provider;
  }
  if (isWalletStandard(provider)) {
    return wrapWalletStandard(provider, plan);
  }
  throw new Error(
    "Solana Irys upload requires a Wallet Standard wallet or MessageSigner provider",
  );
}
