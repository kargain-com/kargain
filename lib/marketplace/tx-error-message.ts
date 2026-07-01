import { UserRejectedRequestError } from "viem";

const REVERT_COPY: ReadonlyArray<readonly [string, string]> = [
  ["AlreadyListed", "This vehicle is already listed. Delist it first."],
  ["MarketplaceNotApproved", "Approve the marketplace on your passport first."],
  ["CannotRaiseMinPrice", "New minimum must be lower than the current minimum."],
  ["AgentAuthorizationActive", "Return the vehicle from the agent before revoking access."],
  [
    "BelowOwnerMinPrice",
    "Owner would receive less than their guaranteed minimum after fees. Lower commission or raise the asking price.",
  ],
  [
    "AgentNotAuthorized",
    "You are not authorized to act for this vehicle, or the authorization expired.",
  ],
  ["AgentFeeTooHigh", "Commission cannot exceed 30%."],
];

function mapRevertReason(message: string): string | null {
  for (const [reason, copy] of REVERT_COPY) {
    if (message.includes(reason)) return copy;
  }
  return null;
}

export function txErrorMessage(err: unknown): string {
  if (
    err instanceof UserRejectedRequestError ||
    (err instanceof Error &&
      (err.message.includes("User rejected") || err.message.includes("User denied")))
  ) {
    return "Wallet signature cancelled.";
  }
  if (err instanceof Error && err.message.trim()) {
    const mapped = mapRevertReason(err.message);
    if (mapped) return mapped;
    return err.message.length > 160 ? `${err.message.slice(0, 160)}…` : err.message;
  }
  return "Transaction failed.";
}
