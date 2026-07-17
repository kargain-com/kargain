/** Auction lifecycle phase stored on `auction.phase`. */
export type AuctionPhase =
  | "CREATED"
  | "BIDDING"
  | "SETTLED"
  | "VOIDED"
  | "CANCELLED"
  | "RETURNED"
  | "RELEASED";

export const AUCTION_PHASE = {
  CREATED: "CREATED",
  BIDDING: "BIDDING",
  SETTLED: "SETTLED",
  VOIDED: "VOIDED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
  RELEASED: "RELEASED",
} as const satisfies Record<string, AuctionPhase>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function bidRowId(txHash: string, logIndex: number): string {
  return `${txHash}-${logIndex}`;
}

/** Native ETH bids use address(0) on-chain — store as empty string in the index. */
export function normalizeAuctionAsset(asset: string): string {
  return asset.toLowerCase() === ZERO_ADDRESS ? "" : asset;
}

export function normalizeAuctionAgent(agent: string): string {
  return agent.toLowerCase() === ZERO_ADDRESS ? "" : agent;
}

export function voidReasonLabel(reason: number): string {
  if (reason === 0) return "UnverifiedPassport";
  if (reason === 1) return "DisputeGraceExpired";
  return `Unknown(${reason})`;
}

export function settlementDisputeOutcomeLabel(outcome: number): string {
  if (outcome === 0) return "ReleaseToSeller";
  if (outcome === 1) return "ConfirmFailure";
  return `Unknown(${outcome})`;
}

export function auctionCreatedRow(params: {
  tokenId: string;
  seller: string;
  agent: string;
  asset: string;
  reserve: bigint;
  duration: bigint;
  agentFeeBps: number;
  ownerMinAsset: bigint;
  timestamp: bigint;
}) {
  return {
    id: params.tokenId,
    tokenId: params.tokenId,
    seller: params.seller,
    agent: normalizeAuctionAgent(params.agent),
    asset: normalizeAuctionAsset(params.asset),
    reserve: params.reserve,
    duration: params.duration,
    agentFeeBps: params.agentFeeBps,
    ownerMinAsset: params.ownerMinAsset,
    startedAt: 0n,
    endsAt: 0n,
    highestBidder: "",
    highestBid: 0n,
    active: true,
    phase: AUCTION_PHASE.CREATED,
    returnRequestedAt: null,
    voidReason: "",
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };
}

export function auctionAgentAuthorizedRow(params: {
  tokenId: string;
  owner: string;
  agent: string;
  expiry: bigint;
  asset: string;
  ownerMinAsset: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  authorizedAt: bigint;
}) {
  return {
    id: params.tokenId,
    tokenId: params.tokenId,
    owner: params.owner,
    agent: params.agent,
    expiry: params.expiry,
    asset: normalizeAuctionAsset(params.asset),
    ownerMinAsset: params.ownerMinAsset,
    active: true,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    authorizedAt: params.authorizedAt,
  };
}
