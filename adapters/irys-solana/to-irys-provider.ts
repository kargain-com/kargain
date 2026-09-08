/**
 * Wallet Standard → Irys Solana provider (`MessageSignerWalletAdapter` shape).
 *
 * Product code must never import `@solana/web3.js`; this adapter owns the bridge.
 * Already-shaped providers (tests / wallet-adapter) pass through unchanged.
 */
import {
  PublicKey,
  type Connection,
  type Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

import type { IrysUploadPlan } from "@/lib/storage/irys-upload-plan";

const SOLANA_SIGN_AND_SEND = "solana:signAndSendTransaction";
const SOLANA_SIGN_MESSAGE = "solana:signMessage";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Compact base58 for Ed25519 signatures — avoids a product-level bs58 dep. */
export function encodeIrysSolanaSignatureBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const size = ((bytes.length - zeros) * 138) / 100 + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i]!;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 256 * b58[k]!;
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let i = size - length;
  while (i < size && b58[i] === 0) i += 1;
  let out = "1".repeat(zeros);
  for (; i < size; i += 1) {
    out += BASE58_ALPHABET[b58[i]!]!;
  }
  return out;
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
        throw new Error("Wallet returned no signature");
      }
      return encodeIrysSolanaSignatureBase58(output.signature);
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
