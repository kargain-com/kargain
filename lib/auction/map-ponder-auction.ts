import { formatPassportShortLabel } from "@/lib/passport/passport-token-id";
import { resolveUri } from "@/lib/storage/resolve-uri";
import type { PassportStatus } from "@/lib/types/ponder";

/** Ponder `auction.phase` values (no ENDED — derived in UI). */
export type PonderAuctionPhase =
  | "CREATED"
  | "BIDDING"
  | "SETTLED"
  | "CANCELLED"
  | "RETURNED"
  | "RELEASED";

/** Blueprint §3 derived UI states (г-1 subset + SETTLED stub). */
export type AuctionUiState =
  | "S1"
  | "S3"
  | "S4"
  | "S5"
  | "SETTLED"
  | "S8"
  | "S9"
  | "NONE";

export type PonderAuctionRaw = {
  id: string;
  tokenId: string;
  chainId: number;
  seller: string;
  agent?: string;
  asset?: string;
  reserve: string | number;
  duration: string | number;
  agentFeeBps?: number;
  ownerMinAsset?: string | number;
  startedAt: string | number;
  endsAt: string | number;
  highestBidder?: string;
  highestBid: string | number;
  active: boolean;
  phase: string;
  returnRequestedAt?: string | number | null;
  createdAt: string | number;
  updatedAt?: string | number;
  passportStatus?: string;
  verifier?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  mileageKm?: number;
  fuelType?: string;
  bodyType?: string;
  transmission?: string;
  tokenUri?: string;
  coverPhotoUri?: string;
  duplicateVin?: boolean;
  settlement?: PonderSettlementRaw | null;
};

export type PonderAuctionBidRaw = {
  id: string;
  tokenId: string;
  bidder: string;
  amount: string | number;
  endsAt?: string | number;
  refunded?: boolean;
  timestamp: string | number;
};

export type PonderSettlementRaw = {
  id?: string;
  tokenId?: string;
  buyer?: string;
  gross?: string | number;
  releaseAt?: string | number;
  disputedAt?: string | number | null;
  bond?: string | number;
  disputeOutcome?: string;
  receiptConfirmedAt?: string | number | null;
  platformFee?: string | number;
  agentFee?: string | number;
  net?: string | number;
  autoRelease?: boolean;
  releasedAt?: string | number | null;
  refundPendingAt?: string | number | null;
  clearedAt?: string | number | null;
  createdAt?: string | number;
  updatedAt?: string | number;
};

export type AuctionRow = {
  chainId: number;
  tokenId: string;
  seller: `0x${string}`;
  agent: string | null;
  asset: string;
  assetLabel: "ETH" | "USDC";
  reserve: bigint;
  duration: bigint;
  agentFeeBps: number;
  ownerMinAsset: bigint;
  startedAt: bigint;
  endsAt: bigint;
  highestBidder: string | null;
  highestBid: bigint;
  active: boolean;
  phase: PonderAuctionPhase;
  returnRequestedAt: bigint | null;
  createdAt: bigint;
  updatedAt: bigint;
  passportStatus: PassportStatus;
  verifier: string;
  title: string;
  imageUrl: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  duplicateVin: boolean;
  settlement: AuctionSettlement | null;
};

export type AuctionBid = {
  id: string;
  tokenId: string;
  bidder: `0x${string}`;
  amount: bigint;
  endsAt: bigint;
  refunded: boolean;
  timestamp: bigint;
};

export type AuctionSettlement = {
  buyer: string;
  gross: bigint;
  releaseAt: bigint;
  disputedAt: bigint | null;
  bond: bigint;
  disputeOutcome: string;
  receiptConfirmedAt: bigint | null;
  platformFee: bigint;
  agentFee: bigint;
  net: bigint;
  autoRelease: boolean;
  releasedAt: bigint | null;
  refundPendingAt: bigint | null;
  clearedAt: bigint | null;
};

function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (value == null || value === "") return 0n;
  if (typeof value === "bigint") return value;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function toNullableBigInt(
  value: string | number | bigint | null | undefined,
): bigint | null {
  if (value == null || value === "") return null;
  const n = toBigInt(value);
  return n === 0n ? null : n;
}

function normalizePhase(phase: string): PonderAuctionPhase {
  const p = phase.toUpperCase();
  if (
    p === "CREATED" ||
    p === "BIDDING" ||
    p === "SETTLED" ||
    p === "CANCELLED" ||
    p === "RETURNED" ||
    p === "RELEASED"
  ) {
    return p;
  }
  return "CREATED";
}

/** `""` asset = native ETH; otherwise treat as USDC for Phase A. */
export function auctionAssetLabel(asset: string | undefined | null): "ETH" | "USDC" {
  return !asset || asset.trim() === "" ? "ETH" : "USDC";
}

export function auctionPhaseLabel(phase: PonderAuctionPhase | AuctionUiState): string {
  switch (phase) {
    case "CREATED":
    case "S1":
      return "Awaiting first bid";
    case "BIDDING":
    case "S3":
      return "Bidding";
    case "S4":
      return "Bidding open";
    case "S5":
      return "Auction ended";
    case "SETTLED":
      return "Settlement hold";
    case "RELEASED":
    case "S8":
      return "Released";
    case "CANCELLED":
    case "RETURNED":
    case "S9":
      return "Closed";
    case "NONE":
      return "No auction";
    default:
      return phase;
  }
}

function buildTitle(raw: PonderAuctionRaw, chainId: number): string {
  if (raw.year && raw.make && raw.model) {
    return `${raw.year} ${raw.make} ${raw.model}`;
  }
  if (raw.make && raw.model) return `${raw.make} ${raw.model}`;
  return `Vehicle ${formatPassportShortLabel(raw.tokenId, chainId)}`;
}

function coverPhotoUrl(coverPhotoUri: string | undefined): string | null {
  if (!coverPhotoUri?.trim()) return null;
  return resolveUri(coverPhotoUri);
}

function mapSettlement(raw: PonderSettlementRaw | null | undefined): AuctionSettlement | null {
  if (!raw) return null;
  return {
    buyer: String(raw.buyer ?? ""),
    gross: toBigInt(raw.gross),
    releaseAt: toBigInt(raw.releaseAt),
    disputedAt: toNullableBigInt(raw.disputedAt),
    bond: toBigInt(raw.bond),
    disputeOutcome: String(raw.disputeOutcome ?? ""),
    receiptConfirmedAt: toNullableBigInt(raw.receiptConfirmedAt),
    platformFee: toBigInt(raw.platformFee),
    agentFee: toBigInt(raw.agentFee),
    net: toBigInt(raw.net),
    autoRelease: Boolean(raw.autoRelease),
    releasedAt: toNullableBigInt(raw.releasedAt),
    refundPendingAt: toNullableBigInt(raw.refundPendingAt),
    clearedAt: toNullableBigInt(raw.clearedAt),
  };
}

export function mapPonderAuctionRow(raw: PonderAuctionRaw): AuctionRow {
  const chainId = raw.chainId;
  const asset = raw.asset?.trim() ?? "";
  const agent = raw.agent?.trim() ? raw.agent.trim() : null;
  const highestBidder = raw.highestBidder?.trim() ? raw.highestBidder.trim() : null;
  return {
    chainId,
    tokenId: String(raw.tokenId),
    seller: (raw.seller || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    agent,
    asset,
    assetLabel: auctionAssetLabel(asset),
    reserve: toBigInt(raw.reserve),
    duration: toBigInt(raw.duration),
    agentFeeBps: Number(raw.agentFeeBps ?? 0),
    ownerMinAsset: toBigInt(raw.ownerMinAsset),
    startedAt: toBigInt(raw.startedAt),
    endsAt: toBigInt(raw.endsAt),
    highestBidder,
    highestBid: toBigInt(raw.highestBid),
    active: Boolean(raw.active),
    phase: normalizePhase(raw.phase),
    returnRequestedAt: toNullableBigInt(raw.returnRequestedAt),
    createdAt: toBigInt(raw.createdAt),
    updatedAt: toBigInt(raw.updatedAt ?? raw.createdAt),
    passportStatus: (raw.passportStatus ?? "UNVERIFIED") as PassportStatus,
    verifier: String(raw.verifier ?? ""),
    title: buildTitle(raw, chainId),
    imageUrl: coverPhotoUrl(raw.coverPhotoUri),
    make: raw.make ?? null,
    model: raw.model ?? null,
    year: raw.year ?? null,
    mileageKm: raw.mileageKm ?? null,
    duplicateVin: Boolean(raw.duplicateVin),
    settlement: mapSettlement(raw.settlement),
  };
}

export function mapPonderAuctionBid(raw: PonderAuctionBidRaw): AuctionBid {
  return {
    id: String(raw.id),
    tokenId: String(raw.tokenId),
    bidder: (raw.bidder || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    amount: toBigInt(raw.amount),
    endsAt: toBigInt(raw.endsAt),
    refunded: Boolean(raw.refunded),
    timestamp: toBigInt(raw.timestamp),
  };
}

/**
 * U11 — `auction_bid` is append-only per tokenId; drop bids from prior lots.
 */
export function filterBidsForAuction(
  bids: readonly AuctionBid[],
  auctionCreatedAt: bigint,
): AuctionBid[] {
  return bids.filter((b) => b.timestamp >= auctionCreatedAt);
}

/**
 * U13 — live lots by endsAt asc, then awaiting-first-bid (endsAt=0) by createdAt desc.
 */
export function partitionActiveAuctions(rows: readonly AuctionRow[]): AuctionRow[] {
  const live: AuctionRow[] = [];
  const awaiting: AuctionRow[] = [];
  for (const row of rows) {
    if (row.endsAt > 0n) live.push(row);
    else awaiting.push(row);
  }
  live.sort((a, b) => {
    if (a.endsAt === b.endsAt) return 0;
    return a.endsAt < b.endsAt ? -1 : 1;
  });
  awaiting.sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt > b.createdAt ? -1 : 1;
  });
  return [...live, ...awaiting];
}

export type DeriveAuctionUiStateInput = {
  phase: PonderAuctionPhase | string;
  active: boolean;
  /** Chain endsAt (seconds); source of truth for U15. */
  endsAtChain: bigint;
  /** Chain/Ponder startedAt; 0 = awaiting first bid. */
  startedAt: bigint;
  passportStatus: PassportStatus | string;
  /** Unix seconds. */
  now: number | bigint;
};

/**
 * Derive blueprint §3 UI state. Chain endsAt wins for ENDED (U15).
 * Returns S1/S3/S4/S5 (+ SETTLED stub + terminal S8/S9).
 */
export function deriveAuctionUiState(input: DeriveAuctionUiStateInput): AuctionUiState {
  const phase = normalizePhase(String(input.phase));
  const now = typeof input.now === "bigint" ? input.now : BigInt(Math.floor(input.now));
  const endsAt = input.endsAtChain;
  const status = String(input.passportStatus).toUpperCase();

  if (phase === "RELEASED") return "S8";
  if (phase === "CANCELLED" || phase === "RETURNED") return "S9";
  if (phase === "SETTLED") return "SETTLED";

  if (!input.active && phase !== "BIDDING" && phase !== "CREATED") {
    return "NONE";
  }

  // U15: BIDDING + past endsAt → derived ENDED (even while Ponder still says BIDDING)
  if (
    input.active &&
    phase === "BIDDING" &&
    endsAt > 0n &&
    now >= endsAt
  ) {
    return "S5";
  }

  const awaitingFirstBid =
    phase === "CREATED" ||
    (phase === "BIDDING" && input.startedAt === 0n);

  if (input.active && awaitingFirstBid) {
    return "S1";
  }

  if (input.active && phase === "BIDDING") {
    if (status === "DISPUTED") return "S4";
    return "S3";
  }

  if (input.active && phase === "CREATED") return "S1";

  return "NONE";
}

/** Live bidding states that may poll (blueprint §5). */
export function isLiveAuctionUiState(state: AuctionUiState): boolean {
  return state === "S1" || state === "S3" || state === "S4";
}

/** Commerce mutex: auction island owns the slot. */
export function auctionBlocksListingCommerce(
  state: AuctionUiState,
  active: boolean,
): boolean {
  if (state === "S1" || state === "S3" || state === "S4" || state === "S5") return true;
  if (state === "SETTLED") return true;
  if (active && state !== "NONE" && state !== "S8" && state !== "S9") return true;
  return false;
}

/**
 * Fixed-price listing blocks auction create/authorize (custody: NFT in FixedPriceConsignment).
 * Fail-closed while chain `isListed` is unread so listed lots never flash Start auction.
 */
export function marketplaceListingBlocksAuction(input: {
  ponderActive: boolean;
  chainIsListed: boolean | undefined;
  chainListedPending: boolean;
}): boolean {
  if (input.ponderActive || input.chainIsListed === true) return true;
  if (input.chainListedPending) return true;
  return false;
}
