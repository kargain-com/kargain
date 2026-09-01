import {
  type CloseReason,
  ZERO_ADDRESS,
  parseCloseReason,
} from "@/lib/commerce/consignment";
import {
  COMPENSATION_FORM,
  type CompensationForm,
  DENOMINATION_KIND,
  type DenominationKind,
  parseCompensationForm,
  parseDenominationKind,
} from "@/lib/commerce/denomination";
import type { CommerceMode } from "@/lib/commerce/mode";
import type { CustodyUnresolvedCause } from "@/lib/types/ponder";

/** Indexed consignment phase — richer than the on-chain enum. */
export type IndexedConsignmentPhase =
  | "offered"
  | "binding"
  | "held"
  | "closed"
  | "returned";

const INDEXED_PHASES: readonly IndexedConsignmentPhase[] = [
  "offered",
  "binding",
  "held",
  "closed",
  "returned",
];

export function parseIndexedPhase(
  raw: string | null | undefined,
): IndexedConsignmentPhase | null {
  if (!raw) return null;
  return INDEXED_PHASES.includes(raw as IndexedConsignmentPhase)
    ? (raw as IndexedConsignmentPhase)
    : null;
}

/** Live = still on offer or bidding. Held lots block re-listing but are sold. */
export function isIndexedPhaseLive(phase: IndexedConsignmentPhase): boolean {
  return phase === "offered" || phase === "binding";
}

/** Any phase that keeps the passport in mode custody. */
export function isIndexedPhaseOccupying(phase: IndexedConsignmentPhase): boolean {
  return phase === "offered" || phase === "binding" || phase === "held";
}

export function parseCommerceMode(raw: string | null | undefined): CommerceMode | null {
  if (raw === "fixedPrice" || raw === "ascending") return raw;
  return null;
}

/** Ascending terms snapshot joined onto an ascending consignment row. */
export type PonderAscendingTermsRow = {
  duration: number;
  extensionWindow: number;
  protectionWindow: number;
  abandonmentWindow: number;
  minIncrementBps: number;
  reserve: string;
  /** Live standing bid, projected by the API from `consignment_bid`. */
  endsAt?: string | null;
  highestBid?: string | null;
  highestBidder?: string | null;
};

/** Settlement hold joined onto an ascending consignment row. */
export type PonderConsignmentHoldRow = {
  buyer: string;
  gross: string;
  protectionEndsAt: string;
  state: string;
  abandonmentDeadline?: string | null;
  receiptConfirmedAt?: string | null;
  fundsReleasedAt?: string | null;
  reversalStartedAt?: string | null;
};

/** Wire row from `GET /consignments`. */
export type PonderConsignmentRow = {
  id: string;
  chainId: number;
  mode: string;
  modeContract: string;
  tokenId: string;
  saleOrdinal: number;
  seller: string;
  agent?: string | null;
  asset: string;
  denominationKind: number;
  currencyCode?: string | null;
  floor: string;
  compensationForm: number;
  commissionBps: number;
  price: string;
  platformFeeBps: number;
  phase: string;
  closeReason?: number | null;
  openedAt: string;
  closedAt?: string | null;
  recallRequestedAt?: string | null;
  buyer?: string | null;
  settlementNoteSetAt?: string | null;
  updatedAt: string;
  /** Passport denorm added by the API. */
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  coverPhotoUri?: string | null;
  status?: string | null;
  verifier?: string | null;
  custodyChain?: number | null;
  custodyUnresolved?: string | null;
  /** Immutable passport origin when denormed by API. */
  originChainId?: number | null;
  mileageKm?: number | null;
  duplicateVin?: boolean | null;
  fuelType?: string | null;
  bodyType?: string | null;
  transmission?: string | null;
  condition?: string | null;
  vehicleType?: string | null;
  colour?: string | null;
  locationPlaceId?: string | null;
  terms?: PonderAscendingTermsRow | null;
  hold?: PonderConsignmentHoldRow | null;
};

export type ConsignmentRecord = {
  readonly id: string;
  readonly chainId: number;
  readonly mode: CommerceMode;
  readonly modeContract: `0x${string}`;
  readonly tokenId: string;
  readonly saleOrdinal: number;
  readonly seller: `0x${string}`;
  readonly agent: `0x${string}` | null;
  readonly asset: `0x${string}`;
  readonly denominationKind: DenominationKind;
  readonly currencyCode: string;
  readonly floor: bigint;
  readonly compensationForm: CompensationForm;
  readonly commissionBps: number;
  readonly price: bigint;
  readonly platformFeeBps: number;
  readonly phase: IndexedConsignmentPhase;
  readonly closeReason: CloseReason | null;
  readonly openedAt: number;
  readonly closedAt: number | null;
  readonly recallRequestedAt: bigint;
  readonly buyer: `0x${string}` | null;
  readonly hasSettlementNote: boolean;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly vin: string | null;
  readonly coverPhotoUri: string | null;
  readonly status: string | null;
  readonly verifier: string | null;
  readonly duplicateVin: boolean;
  readonly mileageKm: number | null;
  /** Where the NFT lives now (passport denorm; null when fold unresolved). */
  readonly custodyChain: number | null;
  readonly custodyUnresolved?: CustodyUnresolvedCause | null;
  /** Passport origin chain (denorm; falls back to commerce chain). */
  readonly originChainId: number;
};

function toBigInt(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function toSeconds(value: string | null | undefined): number {
  return Number(toBigInt(value));
}

function toAddress(value: string | null | undefined): `0x${string}` | null {
  if (!value || !value.startsWith("0x")) return null;
  if (value.toLowerCase() === ZERO_ADDRESS) return null;
  return value as `0x${string}`;
}

const CUSTODY_UNRESOLVED_CAUSES = [
  "empty_history",
  "departure_without_arrival",
  "incomplete_crossing_link",
  "unknown_namespace",
  "conflicting_determination",
] as const satisfies readonly CustodyUnresolvedCause[];

function parseCustodyUnresolvedCause(
  value: unknown,
): CustodyUnresolvedCause | null {
  if (typeof value !== "string") return null;
  return (CUSTODY_UNRESOLVED_CAUSES as readonly string[]).includes(value)
    ? (value as CustodyUnresolvedCause)
    : null;
}

/** Fail-closed row mapper: unknown mode or phase drops the row. */
export function mapConsignmentRow(
  row: PonderConsignmentRow | null | undefined,
): ConsignmentRecord | null {
  if (!row) return null;
  const mode = parseCommerceMode(row.mode);
  const phase = parseIndexedPhase(row.phase);
  if (!mode || !phase) return null;
  const modeContract = toAddress(row.modeContract);
  if (!modeContract) return null;

  return {
    id: row.id,
    chainId: row.chainId,
    mode,
    modeContract,
    tokenId: row.tokenId,
    saleOrdinal: row.saleOrdinal,
    seller: toAddress(row.seller) ?? ZERO_ADDRESS,
    agent: toAddress(row.agent),
    asset: toAddress(row.asset) ?? ZERO_ADDRESS,
    denominationKind:
      parseDenominationKind(row.denominationKind) ?? DENOMINATION_KIND.Asset,
    currencyCode: row.currencyCode ?? "",
    floor: toBigInt(row.floor),
    compensationForm:
      parseCompensationForm(row.compensationForm) ?? COMPENSATION_FORM.Margin,
    commissionBps: row.commissionBps ?? 0,
    price: toBigInt(row.price),
    platformFeeBps: row.platformFeeBps ?? 0,
    phase,
    closeReason: parseCloseReason(row.closeReason ?? null),
    openedAt: toSeconds(row.openedAt),
    closedAt: row.closedAt ? toSeconds(row.closedAt) : null,
    recallRequestedAt: toBigInt(row.recallRequestedAt),
    buyer: toAddress(row.buyer),
    hasSettlementNote: row.settlementNoteSetAt != null,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    vin: row.vin ?? null,
    coverPhotoUri: row.coverPhotoUri ?? null,
    status: row.status ?? null,
    verifier: row.verifier ?? null,
    duplicateVin: row.duplicateVin === true,
    mileageKm: row.mileageKm ?? null,
    custodyChain:
      typeof row.custodyChain === "number" && Number.isFinite(row.custodyChain)
        ? row.custodyChain
        : null,
    custodyUnresolved: parseCustodyUnresolvedCause(row.custodyUnresolved),
    originChainId:
      typeof row.originChainId === "number" && Number.isFinite(row.originChainId)
        ? row.originChainId
        : row.chainId,
  };
}

export function mapConsignmentRows(
  rows: readonly PonderConsignmentRow[] | null | undefined,
): ConsignmentRecord[] {
  if (!rows) return [];
  const out: ConsignmentRecord[] = [];
  for (const row of rows) {
    const mapped = mapConsignmentRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Wire row from `GET /consignments/:tokenId/bids`. */
export type PonderConsignmentBidRow = {
  id: string;
  consignmentId: string;
  chainId: number;
  tokenId: string;
  bidder: string;
  amount: string;
  endsAt: string;
  extended?: boolean | null;
  refunded?: boolean | null;
  timestamp: string;
};

export type ConsignmentBidRecord = {
  readonly id: string;
  readonly consignmentId: string;
  readonly chainId: number;
  readonly tokenId: string;
  readonly bidder: `0x${string}`;
  readonly amount: bigint;
  readonly endsAt: bigint;
  readonly extended: boolean;
  readonly refunded: boolean;
  readonly timestamp: number;
};

export function mapConsignmentBidRow(
  row: PonderConsignmentBidRow | null | undefined,
): ConsignmentBidRecord | null {
  if (!row) return null;
  const bidder = toAddress(row.bidder);
  if (!bidder) return null;
  return {
    id: row.id,
    consignmentId: row.consignmentId,
    chainId: row.chainId,
    tokenId: row.tokenId,
    bidder,
    amount: toBigInt(row.amount),
    endsAt: toBigInt(row.endsAt),
    extended: row.extended === true,
    refunded: row.refunded === true,
    timestamp: toSeconds(row.timestamp),
  };
}

export function mapConsignmentBidRows(
  rows: readonly PonderConsignmentBidRow[] | null | undefined,
): ConsignmentBidRecord[] {
  if (!rows) return [];
  const out: ConsignmentBidRecord[] = [];
  for (const row of rows) {
    const mapped = mapConsignmentBidRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Wire row from `GET /mandates`. */
export type PonderMandateRow = {
  id: string;
  chainId: number;
  modeContract: string;
  mode: string;
  tokenId: string;
  owner: string;
  agent: string;
  expiry: string;
  asset: string;
  denominationKind: number;
  currencyCode?: string | null;
  floor: string;
  compensationForm: number;
  commissionBps: number;
  active: boolean;
  grantedAt: string;
  revokedAt?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  coverPhotoUri?: string | null;
  /** API join: is there a live consignment for this mandate's token? */
  hasLiveConsignment?: boolean | null;
};

export type MandateRecord = {
  readonly id: string;
  readonly chainId: number;
  readonly mode: CommerceMode;
  readonly modeContract: `0x${string}`;
  readonly tokenId: string;
  readonly owner: `0x${string}`;
  readonly agent: `0x${string}`;
  readonly expiry: number;
  readonly asset: `0x${string}`;
  readonly denominationKind: DenominationKind;
  readonly currencyCode: string;
  readonly floor: bigint;
  readonly compensationForm: CompensationForm;
  readonly commissionBps: number;
  readonly active: boolean;
  readonly grantedAt: number;
  readonly hasLiveConsignment: boolean;
};

export function mapMandateRow(
  row: PonderMandateRow | null | undefined,
): MandateRecord | null {
  if (!row) return null;
  const mode = parseCommerceMode(row.mode);
  const modeContract = toAddress(row.modeContract);
  const owner = toAddress(row.owner);
  const agent = toAddress(row.agent);
  if (!mode || !modeContract || !owner || !agent) return null;

  return {
    id: row.id,
    chainId: row.chainId,
    mode,
    modeContract,
    tokenId: row.tokenId,
    owner,
    agent,
    expiry: toSeconds(row.expiry),
    asset: toAddress(row.asset) ?? ZERO_ADDRESS,
    denominationKind:
      parseDenominationKind(row.denominationKind) ?? DENOMINATION_KIND.Asset,
    currencyCode: row.currencyCode ?? "",
    floor: toBigInt(row.floor),
    compensationForm:
      parseCompensationForm(row.compensationForm) ?? COMPENSATION_FORM.Margin,
    commissionBps: row.commissionBps ?? 0,
    active: row.active === true,
    grantedAt: toSeconds(row.grantedAt),
    hasLiveConsignment: row.hasLiveConsignment === true,
  };
}

export function mapMandateRows(
  rows: readonly PonderMandateRow[] | null | undefined,
): MandateRecord[] {
  if (!rows) return [];
  const out: MandateRecord[] = [];
  for (const row of rows) {
    const mapped = mapMandateRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Passport denorm nested by `GET /challenges?instance=passport`. */
export type PonderChallengePassportDenorm = {
  status?: string | null;
  coverPhotoUri?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  custodyChain?: number | null;
};

/** Wire row from `GET /challenges`. */
export type PonderChallengeRow = {
  id: string;
  chainId: number;
  instance: string;
  instanceContract: string;
  subjectId: string;
  challenger: string;
  bondAmount: string;
  windowDuration: string;
  openedAt: string;
  status: string;
  judge?: string | null;
  outcome?: number | null;
  bondRecipient?: string | null;
  terminalAt?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  coverPhotoUri?: string | null;
  passport?: PonderChallengePassportDenorm | null;
};

export type ChallengeInstance = "passport" | "ascending";
export type ChallengeStatus = "open" | "withdrawn" | "judged" | "concluded";

const CHALLENGE_STATUSES: readonly ChallengeStatus[] = [
  "open",
  "withdrawn",
  "judged",
  "concluded",
];

export type ChallengeRecord = {
  readonly id: string;
  readonly chainId: number;
  readonly instance: ChallengeInstance;
  readonly instanceContract: `0x${string}`;
  readonly subjectId: string;
  readonly challenger: `0x${string}`;
  readonly bondAmount: bigint;
  readonly windowDuration: number;
  readonly openedAt: number;
  readonly status: ChallengeStatus;
  readonly judge: `0x${string}` | null;
  readonly outcome: number | null;
  readonly terminalAt: number | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly coverPhotoUri: string | null;
};

export function mapChallengeRow(
  row: PonderChallengeRow | null | undefined,
): ChallengeRecord | null {
  if (!row) return null;
  const instance =
    row.instance === "passport" || row.instance === "ascending" ? row.instance : null;
  const status = CHALLENGE_STATUSES.includes(row.status as ChallengeStatus)
    ? (row.status as ChallengeStatus)
    : null;
  const instanceContract = toAddress(row.instanceContract);
  const challenger = toAddress(row.challenger);
  if (!instance || !status || !instanceContract || !challenger) return null;

  const pass = row.passport;
  const make = row.make ?? pass?.make ?? null;
  const model = row.model ?? pass?.model ?? null;
  const year = row.year ?? pass?.year ?? null;
  const coverPhotoUri = row.coverPhotoUri ?? pass?.coverPhotoUri ?? null;

  return {
    id: row.id,
    chainId: row.chainId,
    instance,
    instanceContract,
    subjectId: row.subjectId,
    challenger,
    bondAmount: toBigInt(row.bondAmount),
    windowDuration: toSeconds(row.windowDuration),
    openedAt: toSeconds(row.openedAt),
    status,
    judge: toAddress(row.judge),
    outcome: row.outcome ?? null,
    terminalAt: row.terminalAt ? toSeconds(row.terminalAt) : null,
    make,
    model,
    year,
    coverPhotoUri,
  };
}

export function mapChallengeRows(
  rows: readonly PonderChallengeRow[] | null | undefined,
): ChallengeRecord[] {
  if (!rows) return [];
  const out: ChallengeRecord[] = [];
  for (const row of rows) {
    const mapped = mapChallengeRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}
