/**
 * Address-centric obligation facts for GET /accounts/:address/obligations
 * and notification approaching projection. Pure mapping + DB assembly.
 */

import { getAddress, zeroAddress } from "viem";

import type {
  ObligationBidFact,
  ObligationChallengeFact,
  ObligationConsignmentFact,
  ObligationFacts,
  ObligationHoldFact,
  ObligationModeFact,
  ObligationPassportFact,
} from "../../lib/obligation/types";

export type ObligationConsignmentRow = {
  id: string;
  chainId: number;
  mode: string;
  modeContract: string;
  tokenId: string;
  seller: string;
  agent: string;
  buyer: string;
  phase: string;
  recallRequestedAt: bigint | null;
};

export type ObligationHoldRow = {
  id: string;
  consignmentId: string;
  chainId: number;
  tokenId: string;
  buyer: string;
  gross: bigint;
  protectionEndsAt: bigint;
  state: string;
  abandonmentDeadline: bigint | null;
};

export type ObligationBidRow = {
  id: string;
  consignmentId: string;
  chainId: number;
  tokenId: string;
  bidder: string;
  amount: bigint;
  endsAt: bigint;
  refunded: boolean;
  timestamp: bigint;
};

export type ObligationChallengeRow = {
  id: string;
  chainId: number;
  instance: string;
  instanceContract: string;
  subjectId: string;
  challenger: string;
  bondAmount: bigint;
  windowDuration: bigint;
  openedAt: bigint;
  status: string;
};

export type ObligationPassportRow = {
  id: string;
  chainId: number;
  owner: string;
  status: string;
  verifier: string;
  disputeOpenedAt: bigint;
  lastDisputer: string;
};

export type ObligationModeRow = {
  chainId: number;
  modeContract: string;
  paused: boolean;
};

function toSec(value: bigint | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

export function mapConsignmentFact(
  row: ObligationConsignmentRow,
): ObligationConsignmentFact {
  const mode =
    row.mode === "ascending" ? "ascending" : "fixedPrice";
  const recall = row.recallRequestedAt;
  return {
    id: row.id,
    chainId: row.chainId,
    mode,
    modeContract: row.modeContract,
    tokenId: row.tokenId,
    seller: row.seller,
    agent: row.agent || zeroAddress,
    buyer: row.buyer || "",
    phase: row.phase,
    recallRequestedAt:
      recall != null && recall > 0n ? toSec(recall) : null,
  };
}

export function mapHoldFact(row: ObligationHoldRow): ObligationHoldFact {
  return {
    id: row.id,
    consignmentId: row.consignmentId,
    chainId: row.chainId,
    tokenId: row.tokenId,
    buyer: row.buyer,
    gross: String(row.gross),
    protectionEndsAt: toSec(row.protectionEndsAt),
    state: row.state,
    abandonmentDeadline:
      row.abandonmentDeadline != null && row.abandonmentDeadline > 0n
        ? toSec(row.abandonmentDeadline)
        : null,
  };
}

export function mapBidFact(row: ObligationBidRow): ObligationBidFact {
  return {
    id: row.id,
    consignmentId: row.consignmentId,
    chainId: row.chainId,
    tokenId: row.tokenId,
    bidder: row.bidder,
    amount: String(row.amount),
    endsAt: toSec(row.endsAt),
    refunded: row.refunded,
    timestamp: toSec(row.timestamp),
  };
}

export function mapChallengeFact(
  row: ObligationChallengeRow,
): ObligationChallengeFact | null {
  if (row.instance !== "passport" && row.instance !== "ascending") {
    return null;
  }
  if (
    row.status !== "open" &&
    row.status !== "withdrawn" &&
    row.status !== "judged" &&
    row.status !== "concluded"
  ) {
    return null;
  }
  return {
    id: row.id,
    chainId: row.chainId,
    instance: row.instance,
    instanceContract: row.instanceContract,
    subjectId: row.subjectId,
    challenger: row.challenger,
    bondAmount: String(row.bondAmount),
    windowDuration: toSec(row.windowDuration),
    openedAt: toSec(row.openedAt),
    status: row.status,
  };
}

export function mapPassportFact(
  row: ObligationPassportRow,
): ObligationPassportFact {
  return {
    tokenId: row.id,
    chainId: row.chainId,
    owner: row.owner,
    status: row.status,
    verifier: row.verifier,
    disputeOpenedAt: toSec(row.disputeOpenedAt),
    lastDisputer: row.lastDisputer,
  };
}

export function mapModeFact(row: ObligationModeRow): ObligationModeFact {
  return {
    chainId: row.chainId,
    modeContract: row.modeContract,
    paused: row.paused,
  };
}

export function mergeConsignmentsById(
  rows: ObligationConsignmentRow[],
): ObligationConsignmentRow[] {
  const map = new Map<string, ObligationConsignmentRow>();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()];
}

export function buildObligationFacts(input: {
  unresolved: boolean;
  consignments: ObligationConsignmentRow[];
  holds: ObligationHoldRow[];
  bids: ObligationBidRow[];
  challenges: ObligationChallengeRow[];
  passports: ObligationPassportRow[];
  modes: ObligationModeRow[];
}): ObligationFacts {
  const challenges: ObligationChallengeFact[] = [];
  for (const row of input.challenges) {
    const mapped = mapChallengeFact(row);
    if (mapped) challenges.push(mapped);
  }
  return {
    unresolved: input.unresolved,
    consignments: mergeConsignmentsById(input.consignments).map(
      mapConsignmentFact,
    ),
    holds: input.holds.map(mapHoldFact),
    bids: input.bids.map(mapBidFact),
    challenges,
    passports: input.passports.map(mapPassportFact),
    modes: input.modes.map(mapModeFact),
  };
}

export function checksumAddress(address: string): string {
  return getAddress(address as `0x${string}`);
}
