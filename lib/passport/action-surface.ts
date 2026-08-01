import {
  type ActionGate,
  AVAILABLE,
  blocked,
  isAvailable,
} from "@/lib/challenge/action-gate";
import type {
  ChallengeBlockCause,
  ChallengeSurface,
} from "@/lib/challenge/surface";
import {
  type PassportPresence,
  passportAwayActionCopy,
  presenceBlocksWrites,
} from "@/lib/passport/presence";
import type { PassportStatus } from "@/lib/types/ponder";

/**
 * Presence causes for passport writes gated by `_requireNotBridgedAway`.
 * Distinct from challenge causes — a passport that is away is not "unverified".
 */
export type PassportPresenceBlockCause = "away" | "reads_unresolved";

export type PassportWriteBlockCause =
  | PassportPresenceBlockCause
  | ChallengeBlockCause
  | "not_owner"
  | "not_holder"
  | "is_holder"
  | "not_verifier"
  | "is_owner"
  | "listing_active"
  | "disputed"
  | "wrong_status"
  | "no_wallet"
  | "verifier_unresolved"
  /** Passport contract address unresolved on the custody chain. */
  | "not_configured";

/** Causes the edit route may surface as a named refusal (not `notFound`). */
export type PassportEditRefusalCause =
  | PassportPresenceBlockCause
  | "disputed"
  | "listing_active"
  | "not_configured";

export type PassportEditAccess =
  | { readonly status: "allow"; readonly presence: PassportPresence }
  | {
      readonly status: "refuse";
      readonly cause: PassportEditRefusalCause;
      readonly presence: PassportPresence;
    };

export type ResolvePassportEditAccessInput = {
  /** Already derived — this helper does not re-derive presence. */
  readonly presence: PassportPresence;
  readonly status: PassportStatus;
  /** True when a selling mode holds the NFT (escrow / consigned). */
  readonly listingActive: boolean;
  /** False when `karPassportAddress(custodyChain)` is unset. */
  readonly configured: boolean;
};

export type PassportActionSurface = {
  readonly presence: PassportPresence;
  /** Factual copy when presence blocks writes; empty when here. */
  readonly presenceCopy: string;
  readonly editMetadata: ActionGate<PassportWriteBlockCause>;
  readonly verify: ActionGate<PassportWriteBlockCause>;
  readonly appendRecord: ActionGate<PassportWriteBlockCause>;
  /** Owner clarification during DISPUTED — same entrypoint as appendRecord. */
  readonly ownerClarification: ActionGate<PassportWriteBlockCause>;
  readonly reportDiscrepancy: ActionGate<PassportWriteBlockCause>;
  readonly appendAttestation: ActionGate<PassportWriteBlockCause>;
  readonly open: ActionGate<PassportWriteBlockCause>;
  readonly withdraw: ActionGate<PassportWriteBlockCause>;
  readonly judge: ActionGate<PassportWriteBlockCause>;
  readonly conclude: ActionGate<PassportWriteBlockCause>;
  /** Challenge phase chrome — from the composed challenge surface. */
  readonly challenge: ChallengeSurface;
};

export type DerivePassportActionSurfaceInput = {
  readonly presence: PassportPresence;
  readonly challenge: ChallengeSurface;
  readonly wallet: string | undefined;
  readonly isOwner: boolean;
  readonly holder: boolean;
  /** `undefined` while active-verifier read is unresolved. */
  readonly isActiveVerifier: boolean | undefined;
  readonly status: PassportStatus;
  readonly listingActive: boolean;
};

function presenceGate(
  presence: PassportPresence,
): ActionGate<PassportWriteBlockCause> | null {
  if (presence.status === "unresolved") {
    return blocked("reads_unresolved");
  }
  if (presence.status === "away") {
    return blocked("away");
  }
  return null;
}

function mapChallengeGate(
  gate: ActionGate<ChallengeBlockCause>,
): ActionGate<PassportWriteBlockCause> {
  if (gate.status === "available") return AVAILABLE;
  return blocked(gate.cause);
}

/**
 * Sole owner of passport write availability for Actions.
 * Presence (custody lock / not here) gates every contract entrypoint that
 * `_requireNotBridgedAway` guards; challenge actions then compose
 * `deriveChallengeSurface`.
 */
/**
 * Factual body copy for an edit-route refusal. Presence causes reuse
 * `passportAwayActionCopy`; other causes stay in this module’s vocabulary.
 */
export function editMetadataRefusalCopy(
  cause: PassportEditRefusalCause,
  presence: PassportPresence,
): string {
  if (cause === "away" || cause === "reads_unresolved") {
    return passportAwayActionCopy(presence);
  }
  if (cause === "disputed") {
    return "This passport is under challenge. Metadata can be edited after the challenge ends.";
  }
  if (cause === "listing_active") {
    return "This passport is held in a selling mode. Metadata can be edited after delisting.";
  }
  return "Passport is not configured on this chain.";
}

/**
 * Server edit-route access from already-derived presence + status + custody facts.
 * Same priority as `editMetadata` after presence: disputed → listing_active.
 * Does not re-derive presence.
 */
export function resolvePassportEditAccess(
  input: ResolvePassportEditAccessInput,
): PassportEditAccess {
  const { presence } = input;
  if (!input.configured) {
    return { status: "refuse", cause: "not_configured", presence };
  }
  const presenceBlock = presenceGate(presence);
  if (presenceBlock != null && presenceBlock.status === "blocked") {
    return {
      status: "refuse",
      cause: presenceBlock.cause as PassportPresenceBlockCause,
      presence,
    };
  }
  if (input.status === "DISPUTED") {
    return { status: "refuse", cause: "disputed", presence };
  }
  if (input.listingActive) {
    return { status: "refuse", cause: "listing_active", presence };
  }
  return { status: "allow", presence };
}

export function derivePassportActionSurface(
  input: DerivePassportActionSurfaceInput,
): PassportActionSurface {
  const presenceBlock = presenceGate(input.presence);
  const presenceCopy = presenceBlocksWrites(input.presence)
    ? passportAwayActionCopy(input.presence)
    : "";

  if (presenceBlock != null) {
    return {
      presence: input.presence,
      presenceCopy,
      editMetadata: presenceBlock,
      verify: presenceBlock,
      appendRecord: presenceBlock,
      ownerClarification: presenceBlock,
      reportDiscrepancy: presenceBlock,
      appendAttestation: presenceBlock,
      open: presenceBlock,
      withdraw: presenceBlock,
      judge: presenceBlock,
      conclude: presenceBlock,
      challenge: input.challenge,
    };
  }

  const editMetadata = (() => {
    if (!input.wallet) return blocked("no_wallet");
    if (!input.isOwner) return blocked("not_owner");
    if (input.status === "DISPUTED") return blocked("disputed");
    if (input.listingActive) return blocked("listing_active");
    return AVAILABLE;
  })();

  const verify = (() => {
    if (!input.wallet) return blocked("no_wallet");
    if (input.isActiveVerifier === undefined) {
      return blocked("verifier_unresolved");
    }
    if (input.isActiveVerifier !== true) return blocked("not_verifier");
    if (input.isOwner) return blocked("is_owner");
    if (input.status !== "UNVERIFIED") return blocked("wrong_status");
    return AVAILABLE;
  })();

  const appendRecord = (() => {
    if (!input.wallet) return blocked("no_wallet");
    if (!input.isOwner) return blocked("not_owner");
    if (input.status === "DISPUTED") return blocked("disputed");
    if (input.listingActive) return blocked("listing_active");
    return AVAILABLE;
  })();

  const ownerClarification = (() => {
    if (!input.wallet) return blocked("no_wallet");
    if (!input.isOwner) return blocked("not_owner");
    if (input.status !== "DISPUTED") return blocked("wrong_status");
    if (input.listingActive) return blocked("listing_active");
    return AVAILABLE;
  })();

  const reportDiscrepancy = (() => {
    if (!input.wallet) return blocked("no_wallet");
    if (input.holder) return blocked("is_holder");
    return AVAILABLE;
  })();

  const appendAttestation = (() => {
    if (!input.wallet) return blocked("no_wallet");
    if (input.isActiveVerifier === undefined) {
      return blocked("verifier_unresolved");
    }
    if (input.isActiveVerifier !== true) return blocked("not_verifier");
    if (input.isOwner) return blocked("is_owner");
    return AVAILABLE;
  })();

  return {
    presence: input.presence,
    presenceCopy,
    editMetadata,
    verify,
    appendRecord,
    ownerClarification,
    reportDiscrepancy,
    appendAttestation,
    open: mapChallengeGate(input.challenge.open),
    withdraw: mapChallengeGate(input.challenge.withdraw),
    judge: mapChallengeGate(input.challenge.judge),
    conclude: mapChallengeGate(input.challenge.conclude),
    challenge: input.challenge,
  };
}

export { isAvailable };
