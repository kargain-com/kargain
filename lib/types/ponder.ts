export type PassportStatus = "UNVERIFIED" | "VERIFIED" | "DISPUTED";

export type ListingStatus = "active" | "sold";

export type PassportRow = {
  chainId: number;
  tokenId: string;
  owner: `0x${string}`;
  vin: string;
  status: PassportStatus;
  verifier: `0x${string}`;
  metadataURI: string;
};

export type ListingRow = {
  chainId: number;
  tokenId: string;
  seller: `0x${string}`;
  /** Fiat price in 1e8 units (on-chain listing price). */
  priceNative: string;
  fiatCurrency: number;
  status: ListingStatus;
  metadataURI: string;
  updatedAtBlock: string;
  listedBlockTimestamp: string;
};

export type VerifierRow = {
  address: `0x${string}`;
  tokenId: string;
  category: string;
  name: string;
};

export type FacetsResponse = {
  makes: string[];
  models: Record<string, string[]>;
  yearMin: number;
  yearMax: number;
  priceMin: number;
  priceMax: number;
  mileageMax: number;
  fuelTypes: string[];
  bodyTypes: string[];
  transmissions: string[];
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
