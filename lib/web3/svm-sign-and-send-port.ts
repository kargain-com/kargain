/**
 * Wallet Standard → {@link SvmSignAndSendPort} binding.
 *
 * Lives beside the SVM session owner: the `Wallet` handle is obtained from
 * {@link useSvmAccountAdapter} / session; this module only binds the feature.
 * One feature only — `solana:signAndSendTransaction`. No cluster invent.
 */

import type { Wallet, WalletAccount } from "@wallet-standard/base";

import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";

const SOLANA_SIGN_AND_SEND = "solana:signAndSendTransaction";

type SignAndSendFeature = {
  signAndSendTransaction: (
    ...inputs: readonly {
      account: WalletAccount;
      chain: `${string}:${string}`;
      transaction: Uint8Array;
    }[]
  ) => Promise<readonly { signature: Uint8Array }[]>;
};

export type CreateSvmSignAndSendPortCause =
  | "wallet_cannot_sign_and_send"
  | "no_connected_account";

export type CreateSvmSignAndSendPortResult =
  | { ok: true; port: SvmSignAndSendPort }
  | {
      ok: false;
      cause: CreateSvmSignAndSendPortCause;
      detail: string;
    };

/**
 * Bind Wallet Standard `solana:signAndSendTransaction` into the write port.
 * Refuses by name when the feature is absent or no account is connected.
 * Does not invent a cluster — `chain` is supplied by the write adapter from
 * {@link walletStandardChainOf}.
 */
export function createSvmSignAndSendPort(
  wallet: Wallet,
): CreateSvmSignAndSendPortResult {
  const account = wallet.accounts[0];
  if (account == null) {
    return {
      ok: false,
      cause: "no_connected_account",
      detail: `Wallet ${wallet.name} has no connected account`,
    };
  }

  const feature = wallet.features[SOLANA_SIGN_AND_SEND] as
    | SignAndSendFeature
    | undefined;
  if (
    feature == null ||
    typeof feature.signAndSendTransaction !== "function"
  ) {
    return {
      ok: false,
      cause: "wallet_cannot_sign_and_send",
      detail: `Wallet ${wallet.name} does not support ${SOLANA_SIGN_AND_SEND}`,
    };
  }

  const port: SvmSignAndSendPort = {
    async signAndSendTransaction({ transaction, chain }) {
      const [output] = await feature.signAndSendTransaction({
        account,
        chain: chain as `${string}:${string}`,
        transaction,
      });
      if (output == null || output.signature == null) {
        return new Uint8Array(0);
      }
      return output.signature;
    },
  };
  return { ok: true, port };
}
