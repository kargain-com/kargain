import {
  type ActionGate,
  AVAILABLE,
  isAvailable,
} from "@/lib/challenge/action-gate";
import type {
  ChallengeBlockCause,
  ChallengeSurface,
} from "@/lib/challenge/surface";
import {
  type DerivePassportPresenceInput,
  type PassportPresence,
  derivePassportPresence,
  passportAwayActionCopy,
  presenceBlocksWrites,
} from "@/lib/passport/presence";
import type { PassportStatus } from "@/lib/types/ponder";

/**
 * Presence causes for passport writes gated by `_requireNotBridgedAway`.
 * Distinct from challenge causes — a passport that is away is not "unverified".
 */
export type PassportPresenceBlockCause =
  | "away"
  | "reads_unresolved"
  | "custody_unresolved";

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

export type PassportWriteNonPresenceBlockCause = Exclude<
  PassportWriteBlockCause,
  "away" | "custody_unresolved"
>;

export type PassportPresenceBlockedGate = {
  readonly status: "blocked";
  readonly blockedBy: "presence";
  readonly cause: PassportPresenceBlockCause;
  readonly presence: PassportPresence;
};

export type PassportWriteBlockedGate = {
  readonly status: "blocked";
  readonly blockedBy: "write";
  readonly cause: PassportWriteNonPresenceBlockCause;
};

export type PassportWriteGate =
  | { readonly status: "available" }
  | PassportPresenceBlockedGate
  | PassportWriteBlockedGate;

export type PassportEditAccess =
  | { readonly status: "allow"; readonly presence: PassportPresence }
  | {
      readonly status: "refuse";
      readonly cause: PassportEditRefusalCause;
      readonly presence: PassportPresence;
    };

export type ResolvePassportEditAccessInput = {
  readonly presenceFacts: DerivePassportPresenceInput;
  readonly status: PassportStatus;
  /** True when a selling mode holds the NFT (escrow / consigned). */
  readonly listingActive: boolean;
  /** False when `karPassportAddress(custodyChain)` is unset. */
  readonly configured: boolean;
};

/** Marketplace / detail location refusal — never a not-found outcome. */
export type PassportLocationRefusal =
  | {
      readonly status: "ok";
      readonly presence: PassportPresence;
    }
  | {
      readonly status: "refuse";
      readonly presence: PassportPresence;
      readonly cause: "reads_unresolved" | "custody_unresolved";
      readonly title: string;
      readonly description: string;
    };

export type PassportActionSurface = {
  readonly presence: PassportPresence;
  /** Factual copy when presence blocks writes; empty when here. */
  readonly presenceCopy: string;
  readonly editMetadata: PassportWriteGate;
  readonly verify: PassportWriteGate;
  readonly appendRecord: PassportWriteGate;
  /** Owner clarification during DISPUTED — same entrypoint as appendRecord. */
  readonly ownerClarification: PassportWriteGate;
  readonly reportDiscrepancy: PassportWriteGate;
  readonly appendAttestation: PassportWriteGate;
  readonly open: PassportWriteGate;
  readonly withdraw: PassportWriteGate;
  readonly judge: PassportWriteGate;
  readonly conclude: PassportWriteGate;
  /** Challenge phase chrome — from the composed challenge surface. */
  readonly challenge: ChallengeSurface;
};

export type DerivePassportActionSurfaceInput = {
  readonly presenceFacts: DerivePassportPresenceInput;
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
): PassportPresenceBlockedGate | null {
  if (presence.status === "location_unread") {
    return {
      status: "blocked",
      blockedBy: "presence",
      cause: "reads_unresolved",
      presence,
    };
  }
  if (presence.status === "location_unresolved") {
    return {
      status: "blocked",
      blockedBy: "presence",
      cause: "custody_unresolved",
      presence,
    };
  }
  if (presence.status === "away") {
    return {
      status: "blocked",
      blockedBy: "presence",
      cause: "away",
      presence,
    };
  }
  return null;
}

function mapChallengeGate(
  gate: ActionGate<ChallengeBlockCause>,
): PassportWriteGate {
  if (gate.status === "available") return AVAILABLE;
  return blockedWrite(gate.cause);
}

function blockedWrite(
  cause: PassportWriteNonPresenceBlockCause,
): PassportWriteBlockedGate {
  return {
    status: "blocked",
    blockedBy: "write",
    cause,
  };
}

/**
 * Derive presence from honest facts — sole action-surface entry for location.
 * Components and routes call this (or bridge-surface / the presence hook) instead
 * of `derivePassportPresence`.
 */
export function resolvePassportPresence(
  facts: DerivePassportPresenceInput,
): PassportPresence {
  return derivePassportPresence(facts);
}

/**
 * Marketplace / detail location refusal from indexer facts.
 * Never returns a not-found sentinel — location gaps are named refusals.
 */
export function resolvePassportLocationRefusal(
  facts: DerivePassportPresenceInput,
): PassportLocationRefusal {
  const presence = derivePassportPresence(facts);
  if (presence.status === "location_unread") {
    return {
      status: "refuse",
      presence,
      cause: "reads_unresolved",
      title: "Location could not be read",
      description: passportAwayActionCopy(presence),
    };
  }
  if (presence.status === "location_unresolved") {
    return {
      status: "refuse",
      presence,
      cause: "custody_unresolved",
      title: "Passport location is unresolved",
      description: passportAwayActionCopy(presence),
    };
  }
  return { status: "ok", presence };
}

/**
 * Factual body copy for an edit-route refusal. Presence causes reuse
 * `passportAwayActionCopy`; other causes stay in this module’s vocabulary.
 */
export function editMetadataRefusalCopy(
  cause: PassportEditRefusalCause,
  presence: PassportPresence,
): string {
  if (
    cause === "away" ||
    cause === "reads_unresolved" ||
    cause === "custody_unresolved"
  ) {
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
 * Server edit-route access — derives presence from facts inside this owner.
 */
export function resolvePassportEditAccess(
  input: ResolvePassportEditAccessInput,
): PassportEditAccess {
  const presence = derivePassportPresence(input.presenceFacts);
  if (!input.configured) {
    return { status: "refuse", cause: "not_configured", presence };
  }
  const presenceBlock = presenceGate(presence);
  if (presenceBlock != null && presenceBlock.status === "blocked") {
    return {
      status: "refuse",
      cause: presenceBlock.cause,
      presence: presenceBlock.presence,
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

/**
 * Sole owner of passport write availability for Actions.
 * Presence (custody lock / not here) gates every contract entrypoint that
 * `_requireNotBridgedAway` guards; challenge actions then compose
 * `deriveChallengeSurface`.
 */
export function derivePassportActionSurface(
  input: DerivePassportActionSurfaceInput,
): PassportActionSurface {
  const presence = derivePassportPresence(input.presenceFacts);
  const presenceBlock = presenceGate(presence);
  const presenceCopy = presenceBlocksWrites(presence)
    ? passportAwayActionCopy(presence)
    : "";

  if (presenceBlock != null) {
    return {
      presence,
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
    if (!input.wallet) return blockedWrite("no_wallet");
    if (!input.isOwner) return blockedWrite("not_owner");
    if (input.status === "DISPUTED") return blockedWrite("disputed");
    if (input.listingActive) return blockedWrite("listing_active");
    return AVAILABLE;
  })();

  const verify = (() => {
    if (!input.wallet) return blockedWrite("no_wallet");
    if (input.isActiveVerifier === undefined) {
      return blockedWrite("verifier_unresolved");
    }
    if (input.isActiveVerifier !== true) return blockedWrite("not_verifier");
    if (input.isOwner) return blockedWrite("is_owner");
    if (input.status !== "UNVERIFIED") return blockedWrite("wrong_status");
    return AVAILABLE;
  })();

  const appendRecord = (() => {
    if (!input.wallet) return blockedWrite("no_wallet");
    if (!input.isOwner) return blockedWrite("not_owner");
    if (input.status === "DISPUTED") return blockedWrite("disputed");
    if (input.listingActive) return blockedWrite("listing_active");
    return AVAILABLE;
  })();

  const ownerClarification = (() => {
    if (!input.wallet) return blockedWrite("no_wallet");
    if (!input.isOwner) return blockedWrite("not_owner");
    if (input.status !== "DISPUTED") return blockedWrite("wrong_status");
    if (input.listingActive) return blockedWrite("listing_active");
    return AVAILABLE;
  })();

  const reportDiscrepancy = (() => {
    if (!input.wallet) return blockedWrite("no_wallet");
    if (input.holder) return blockedWrite("is_holder");
    return AVAILABLE;
  })();

  const appendAttestation = (() => {
    if (!input.wallet) return blockedWrite("no_wallet");
    if (input.isActiveVerifier === undefined) {
      return blockedWrite("verifier_unresolved");
    }
    if (input.isActiveVerifier !== true) return blockedWrite("not_verifier");
    if (input.isOwner) return blockedWrite("is_owner");
    return AVAILABLE;
  })();

  return {
    presence,
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
