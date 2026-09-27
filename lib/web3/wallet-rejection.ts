/**
 * Sole typed classifier for user wallet rejection (Create / KarPro / Irys / tx-error).
 * Detects viem UserRejectedRequestError, EIP-1193 code 4001, and Wallet Standard
 * rejection discriminants — never message substring matching.
 */

import { UserRejectedRequestError } from "viem";

/** Sole product sentence for a user-cancelled wallet signature / send. */
export const WALLET_REJECTION_COPY =
  "Transaction cancelled. Try again when ready.";

export function walletRejectionCopy(): string {
  return WALLET_REJECTION_COPY;
}

function hasEip1193Code4001(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === 4001 || code === "4001";
}

const WALLET_STANDARD_REJECTION_NAMES = new Set([
  "walletsignandinjectionrejectederror",
  "walletrequestrejected",
  "userrejectedrequesterror",
  "rejectrequest",
]);

/**
 * Wallet Standard / adapter rejection discriminants (not program-send failures).
 */
function isWalletStandardRejection(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const rec = err as { name?: unknown; error?: unknown; code?: unknown };
  if (typeof rec.name === "string") {
    const n = rec.name.toLowerCase();
    if (WALLET_STANDARD_REJECTION_NAMES.has(n)) return true;
    if (n === "userrejectedrequesterror") return true;
  }
  if (rec.error === "rejected" || rec.error === "user_rejected") return true;
  if (rec.code === "USER_REJECTED" || rec.code === "user_rejected") return true;
  return false;
}

/**
 * True when the user declined a signature or send in the wallet UI.
 * Program failures, RPC errors, and Irys funding errors are false.
 */
export function isWalletRejection(err: unknown): boolean {
  if (err instanceof UserRejectedRequestError) return true;
  if (hasEip1193Code4001(err)) return true;
  if (isWalletStandardRejection(err)) return true;
  return false;
}
