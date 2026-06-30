import { UserRejectedRequestError } from "viem";

export function txErrorMessage(err: unknown): string {
  if (
    err instanceof UserRejectedRequestError ||
    (err instanceof Error &&
      (err.message.includes("User rejected") || err.message.includes("User denied")))
  ) {
    return "Wallet signature cancelled.";
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message.length > 160 ? `${err.message.slice(0, 160)}…` : err.message;
  }
  return "Transaction failed.";
}
