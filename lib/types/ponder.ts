export type PassportStatus = "UNVERIFIED" | "VERIFIED" | "DISPUTED";

export type ListingStatus = "active" | "sold";

export type PassportRow = {
  chainId: number;
  tokenId: string;
  owner: `0x${string}`;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  status: PassportStatus;
  verifier: `0x${string}`;
  tokenUri: string;
  duplicateVin: boolean;
};

export type ListingRow = {
  chainId: number;
  tokenId: string;
  seller: `0x${string}`;
  /** Fiat price in 1e8 units (on-chain listing price). */
  priceNative: string;
  fiatCurrency: number;
  status: ListingStatus;
  passportStatus: PassportStatus;
  tokenUri: string;
  title: string;
  imageUrl: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  duplicateVin: boolean;
  updatedAtBlock: string;
  listedBlockTimestamp: string;
};

export type VerifierRow = {
  address: `0x${string}`;
  category: number;
  name: string;
  metadataURI: string;
  active: boolean;
};

export type FacetsResponse = {
  makes: string[];
  models: Record<string, string[]>;
  yearMin: number;
  yearMax: number;
  priceMin: number;
  priceMax: number;
  priceRanges?: {
    USD: { min: number; max: number };
    EUR: { min: number; max: number };
  };
  mileageMax: number;
  fuelTypes?: string[];
  bodyTypes?: string[];
  transmissions?: string[];
  fiatCurrencies: number[];
  totalActive: number;
  statusCounts: Record<PassportStatus, number>;
};

export type PonderListingsResponse = {
  listings: ListingRow[];
  total: number;
  page: number;
  totalPages: number;
};

export type PonderPassportsResponse = {
  passports: PassportRow[];
  total: number;
  page?: number;
};

export type PonderProfilePassportsResponse = {
  passports: PassportRow[];
};

export type PonderProfileListingsResponse = {
  listings: ListingRow[];
};

export type PonderVerifiersResponse = {
  verifiers: VerifierRow[];
};

export type PonderHealthResponse = {
  status: "ok";
  chain: number;
  latestBlock: number;
};

export type PonderErrorCode = "PONDER_NOT_CONFIGURED" | "PONDER_UNAVAILABLE";

export type PonderPassportRecord = {
  id: string;
  tokenId: string;
  author: string;
  recordType: string;
  description: string;
  evidenceCID: string;
  timestamp: string;
};

export type PonderUriHistoryEntry = {
  id: string;
  tokenId: string;
  previousUri: string;
  newUri: string;
  author: string;
  verificationReset: boolean;
  timestamp: string;
};

export type PonderPassportDetail = {
  id: string;
  owner: string;
  status: PassportStatus;
  verifier: string;
  verifiedAt: string;
  tokenUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  lastDisputer: string;
  disputeReason: string;
  disputeWithdrawnAt: string;
  lastVerificationResetAt: string;
  duplicateVin: boolean;
  createdAt: string;
  updatedAt: string;
  records: PonderPassportRecord[];
  uriHistory: PonderUriHistoryEntry[];
};

export type PonderListingDetail = {
  id: string;
  tokenId: string;
  seller: string;
  fiatPrice1e8: string;
  fiatCurrency: number;
  active: boolean;
  listedAt: string;
  passportStatus: PassportStatus;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  tokenUri: string;
  duplicateVin: boolean;
};

export type PonderVerifierDetail = {
  address: string;
  identity: { category: number; name: string; metadataURI: string };
  stake: { asset: number; amount: string; active: boolean };
  joinedAt: string;
  leftAt: string;
  verificationCount: number;
  disputedPassports: PonderPassportDetail[];
  verifiedPassports: PonderPassportDetail[];
};
