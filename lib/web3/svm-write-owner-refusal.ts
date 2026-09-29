/**
 * Sole typed throw for SVM product write owners inside `runTx` writeFns.
 * Causes cross as values — never `new Error("… refused: …")` sentence throws.
 */

import {
  wrongVmActionCopy,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import { unresolvedNamespaceCopy } from "@/lib/web3/commercial-active";
import { surfaceSupportCauseCopy } from "@/lib/web3/surface-support";
import {
  type SendSvmInstructionCause,
  type SendSvmInstructionResult,
} from "@/lib/web3/svm-write-adapter";
import { walletRejectionCopy } from "@/lib/web3/wallet-rejection";

export type SvmWriteOwnerId =
  | "setPassportUri"
  | "openChallenge"
  | "withdrawChallenge"
  | "concludeChallenge"
  | "judgeChallenge"
  | "reportPassportDiscrepancy"
  | "appendPassportRecord"
  | "appendPassportAttestation"
  | "verifyPassport"
  | "setVerificationFee"
  | "openFixedPriceConsignment";

/** Plan + send causes thrown by the eleven SVM write owners. */
export type SvmWriteOwnerRefusalCause =
  | SendSvmInstructionCause
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "passport_not_configured"
  | "staking_not_configured"
  | "mode_not_configured"
  | "invalid_token_id"
  | "invalid_outcome"
  | "invalid_price"
  | "invalid_fee"
  | "deposit_unknown"
  | "encode_failed"
  | "pda_failed"
  | "state_unavailable"
  | "state_decode_failed"
  | "recipient_unresolved"
  | "recipient_decode_failed"
  | "fiat_not_supported"
  | "settlement_not_native"
  | "encumbrance_seed_required"
  | "config_unavailable"
  | "config_decode_failed"
  | "send_failed";

export class SvmWriteOwnerRefusal extends Error {
  readonly owner: SvmWriteOwnerId;
  readonly cause: SvmWriteOwnerRefusalCause;
  readonly detail: string | undefined;
  readonly error: unknown | undefined;
  readonly wanted: WalletFamilyWanted | undefined;

  constructor(args: {
    owner: SvmWriteOwnerId;
    cause: SvmWriteOwnerRefusalCause;
    detail?: string;
    error?: unknown;
    wanted?: WalletFamilyWanted;
  }) {
    super(args.cause);
    this.name = "SvmWriteOwnerRefusal";
    this.owner = args.owner;
    this.cause = args.cause;
    this.detail = args.detail;
    this.error = args.error;
    this.wanted = args.wanted;
  }
}

export function isSvmWriteOwnerRefusal(
  err: unknown,
): err is SvmWriteOwnerRefusal {
  return err instanceof SvmWriteOwnerRefusal;
}

/** Throw a typed refusal from a failed {@link sendSvmInstruction}. */
export function throwSvmWriteSendRefusal(
  owner: SvmWriteOwnerId,
  sent: Extract<SendSvmInstructionResult, { ok: false }>,
): never {
  if (sent.cause === "wallet_send_failed") {
    throw new SvmWriteOwnerRefusal({
      owner,
      cause: "wallet_send_failed",
      error: sent.error,
    });
  }
  throw new SvmWriteOwnerRefusal({
    owner,
    cause: sent.cause,
    detail: sent.detail,
  });
}

/**
 * Sole sentence owner for {@link SvmWriteOwnerRefusal}.
 * Never renders `err.message` / `detail` as user copy.
 */
export function svmWriteOwnerRefusalCopy(
  refusal: SvmWriteOwnerRefusal,
): string {
  switch (refusal.cause) {
    case "wallet_rejected":
      return walletRejectionCopy();
    case "disconnected":
      return "Connect a wallet to send this transaction.";
    case "wrong_vm":
      return refusal.wanted != null
        ? wrongVmActionCopy(refusal.wanted)
        : "Switch to a wallet that matches this network.";
    case "unresolved_namespace":
      return unresolvedNamespaceCopy();
    case "not_in_program":
      return surfaceSupportCauseCopy("not_in_program");
    case "product_owner_owed":
      return surfaceSupportCauseCopy("product_owner_owed");
    case "authority_only":
      return surfaceSupportCauseCopy("authority_only");
    case "no_connected_account":
      return "Connect a Solana wallet to continue.";
    case "wallet_cannot_sign_and_send":
      return "This wallet cannot sign and send on Solana.";
    case "wallet_send_failed":
      return "The wallet could not send this transaction. Try again.";
    case "wallet_returned_no_signature":
      return "The wallet returned no signature.";
    case "signature_not_64_bytes":
      return "The wallet returned an invalid signature.";
    case "blockhash_unavailable":
      return "Could not fetch a recent blockhash. Try again.";
    case "blockhash_expired":
      return "The blockhash expired before send. Try again.";
    case "unregistered_program":
      return "This program is not registered on the selected network.";
    case "empty_instruction_data":
      return "Could not build the instruction.";
    case "missing_wallet_standard_chain":
      return "This network has no Wallet Standard chain id.";
    case "passport_not_configured":
      return "Passport contract not available on this network.";
    case "staking_not_configured":
      return "Staking is not configured on this network.";
    case "mode_not_configured":
      return "This commerce mode is not configured on this network.";
    case "invalid_token_id":
      return "Invalid passport id.";
    case "invalid_outcome":
      return "Invalid challenge outcome.";
    case "invalid_price":
      return "Invalid price.";
    case "invalid_fee":
      return "Invalid verification fee.";
    case "deposit_unknown":
      return "Challenge bond amount is unknown. Try again.";
    case "encode_failed":
      return "Could not build the instruction.";
    case "pda_failed":
      return "Could not derive program accounts.";
    case "state_unavailable":
      return "Passport state could not be read. Try again.";
    case "state_decode_failed":
      return "Passport state on chain could not be decoded.";
    case "recipient_unresolved":
      return "Bond recipient could not be resolved. Try again.";
    case "recipient_decode_failed":
      return "Bond recipient on chain could not be decoded.";
    case "fiat_not_supported":
      return "Fiat denomination is not supported on Solana.";
    case "settlement_not_native":
      return "Only native settlement is supported on Solana.";
    case "encumbrance_seed_required":
      return "Encumbrance seed is required for this write.";
    case "config_unavailable":
      return "Config could not be read. Try again.";
    case "config_decode_failed":
      return "Config on chain could not be decoded.";
    case "send_failed":
      return "The wallet could not send this transaction. Try again.";
    default: {
      const _never: never = refusal.cause;
      return _never;
    }
  }
}
