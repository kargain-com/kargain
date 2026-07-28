import type { DisputeTerminal } from "@/lib/passport/dispute-surface";
import { parseDisputeTerminal } from "@/lib/passport/dispute-surface";
import type { PassportStatus } from "@/lib/types/ponder";

export type DisputeTrustCopyKind =
  | "lapsed"
  | "upheld"
  | "previously_disputed"
  | null;

/**
 * Trust banner / readout copy for closed disputes.
 * Lapse is informational (not status-error): assertion lost backing, not a penalty.
 */
export function disputeTrustCopyKind(params: {
  status: PassportStatus;
  hadDispute: boolean;
  lastDisputeTerminal: string;
}): DisputeTrustCopyKind {
  const terminal = parseDisputeTerminal(params.lastDisputeTerminal);
  if (params.status === "UNVERIFIED" && terminal === "expire") {
    return "lapsed";
  }
  if (params.status === "UNVERIFIED" && terminal === "confirm") {
    return "upheld";
  }
  if (params.hadDispute && params.status !== "DISPUTED") {
    return "previously_disputed";
  }
  return null;
}

export function disputeTerminalTimelineLabel(
  terminal: DisputeTerminal,
): string | null {
  switch (terminal) {
    case "expire":
      return "Verification lapsed";
    case "confirm":
      return "Dispute confirmed";
    case "reject":
      return "Dispute rejected";
    case "withdraw":
      return "Dispute withdrawn";
    default:
      return null;
  }
}

export function disputeTerminalTimelineDescription(
  terminal: DisputeTerminal,
): string | null {
  switch (terminal) {
    case "expire":
      return "The dispute window ended without a professional judgment. Verification lost its backing — a fresh inspection restores it.";
    case "confirm":
      return "An independent KarPro upheld the challenge. Verification was cleared.";
    case "reject":
      return "An independent KarPro rejected the challenge. Verification stands.";
    case "withdraw":
      return "The opener withdrew the dispute. Verification was restored.";
    default:
      return null;
  }
}
