/**
 * Claims fallback — undeliverable bond / payout waits under Claims (PA1).
 * Shared wording so both instances disclose the same rule.
 */
export const CHALLENGE_CLAIMS_DISCLOSURE =
  "If a return cannot be delivered, it waits under Claims.";

export type ChallengeTerminalId =
  | "upheld"
  | "rejected"
  | "expired"
  | "withdrawn";

/**
 * What one terminal means for this instance — consequence text lives here,
 * not in whichever component renders a button.
 */
export type ChallengeTerminalDef = {
  readonly id: ChallengeTerminalId;
  /** Short label for timelines / stamps. */
  readonly label: string;
  /** Longer description for timelines. */
  readonly description: string;
  /** Judge CTA body when offering this outcome (upheld / rejected only). */
  readonly judgeCopy: string;
  /** Conclude / buyer-facing body when this terminal is the window outcome. */
  readonly concludeCopy: string;
};

export type ChallengeTerminalSet = {
  readonly upheld: ChallengeTerminalDef;
  readonly rejected: ChallengeTerminalDef;
  readonly expired: ChallengeTerminalDef;
  readonly withdrawn: ChallengeTerminalDef;
};

export const VERIFICATION_TERMINALS: ChallengeTerminalSet = {
  upheld: {
    id: "upheld",
    label: "Challenge upheld",
    description:
      "An independent KarPro upheld the challenge. Verification was cleared.",
    judgeCopy:
      "The verification was incorrect. Status becomes unverified. The opener’s deposit returns to them in this transaction — if it cannot be delivered, it waits as a claim for them.",
    concludeCopy: "",
  },
  rejected: {
    id: "rejected",
    label: "Challenge rejected",
    description:
      "An independent KarPro rejected the challenge. Verification stands.",
    judgeCopy:
      "The verification stands. Status stays verified. The deposit goes to the platform — never to the resolver. If it cannot be delivered, it waits under Claims.",
    concludeCopy: "",
  },
  expired: {
    id: "expired",
    label: "Verification lapsed",
    description:
      "The challenge window ended without a professional judgment. Verification lost its backing — a fresh inspection restores it.",
    judgeCopy: "",
    concludeCopy:
      "Conclude without a merits judgment. Verification lapses (not a penalty to the owner) — a fresh inspection restores it. The deposit goes to the platform. If it cannot be delivered, it waits under Claims.",
  },
  withdrawn: {
    id: "withdrawn",
    label: "Challenge withdrawn",
    description:
      "The opener withdrew the challenge. Verification was restored.",
    judgeCopy: "",
    concludeCopy: "",
  },
};

export const SETTLEMENT_TERMINALS: ChallengeTerminalSet = {
  upheld: {
    id: "upheld",
    label: "Challenge upheld",
    description:
      "An independent KarPro upheld the settlement challenge. Reversal is pending.",
    judgeCopy:
      "Upholding starts a reversal. The bond returns to the challenger in this transaction. The settled amount returns only when the buyer completes the reversal by returning the passport. If a payout cannot be delivered, it waits under Claims.",
    concludeCopy: "",
  },
  rejected: {
    id: "rejected",
    label: "Challenge rejected",
    description:
      "An independent KarPro rejected the settlement challenge. The seller is paid and the sale closes.",
    judgeCopy:
      "Rejecting pays the seller and closes the sale. The challenger’s bond goes to the platform — not a return of the protection hold. If a payout cannot be delivered, it waits under Claims.",
    concludeCopy: "",
  },
  expired: {
    id: "expired",
    label: "Challenge concluded",
    description:
      "The challenge window ended without a judgment. The seller is paid and the sale closes.",
    judgeCopy: "",
    concludeCopy:
      "Conclude without a merits judgment. The seller is paid and the sale closes. The challenger’s bond goes to the platform. If a payout cannot be delivered, it waits under Claims.",
  },
  withdrawn: {
    id: "withdrawn",
    label: "Challenge withdrawn",
    description:
      "The buyer withdrew the challenge. The protection window resumes from where it stood.",
    judgeCopy: "",
    concludeCopy: "",
  },
};

/** Open-challenge disclosure (bond + freeze / deposit). */
export const VERIFICATION_OPEN_COPY =
  "Opening locks a deposit for the challenge window. Withdraw before the window ends returns it to you. Uphold returns it to the opener. Reject or expiry sends it to the platform. If a return cannot be delivered, it waits under Claims.";

export const SETTLEMENT_OPEN_COPY =
  "Opening a challenge locks a bond and freezes the protection clock. You get the bond back if the challenge is upheld (in the judging transaction). If a return cannot be delivered, it waits under Claims.";

/** Feed / inbox line when the window has ended — conclude only; judge is absent. */
export function challengeElapsedFeedCopy(
  instanceId: "verification" | "settlement",
): string {
  return instanceId === "verification"
    ? "Window ended — conclude on the passport. Judging is no longer available."
    : "Window ended — conclude on the lot. Judging is no longer available.";
}
