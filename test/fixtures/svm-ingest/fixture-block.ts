import {
  buildPassportMintedBody,
  buildPassportUriUpdatedBody,
  buildProgramDataLine,
  buildRecordAppendedBody,
  globalTokenId,
  PASSPORT_MINTED_DISC,
  PASSPORT_URI_UPDATED_DISC,
  RECORD_APPENDED_DISC,
} from "./borsh-fixtures.js";

/** Test fixture program id — kar-passport stand-in for invoke-stack tests. */
export const FIXTURE_PASSPORT_PROGRAM = "11111111111111111111111111111112";

export const FIXTURE_NAMESPACE = 2_000_040_168;

export const FIXTURE_FOLLOWED_PROGRAMS = [
  {
    slug: "kar-passport",
    programId: FIXTURE_PASSPORT_PROGRAM,
    evidenceKey: "kar_passport",
  },
] as const;

export const FIXTURE_TOKEN_ID = globalTokenId(FIXTURE_NAMESPACE, 42);

/** PassportMinted with to, tokenId, uri (manifest field order). */
export function passportMintedProgramDataLine(
  tokenId: bigint = FIXTURE_TOKEN_ID,
  uri = "ar://svm-mint-uri",
): string {
  return buildProgramDataLine({
    discriminatorHex: PASSPORT_MINTED_DISC,
    body: buildPassportMintedBody({ tokenId, uri }),
  });
}

export function recordAppendedProgramDataLine(
  tokenId: bigint = FIXTURE_TOKEN_ID,
): string {
  return buildProgramDataLine({
    discriminatorHex: RECORD_APPENDED_DISC,
    body: buildRecordAppendedBody({
      tokenId,
      recordType: "attestation",
      description: "cross-network fixture",
      evidenceCID: "ar://svm-attestation",
    }),
  });
}

export function passportUriUpdatedProgramDataLine(
  tokenId: bigint = FIXTURE_TOKEN_ID,
  newUri = "ar://svm-uri-v1",
): string {
  return buildProgramDataLine({
    discriminatorHex: PASSPORT_URI_UPDATED_DISC,
    body: buildPassportUriUpdatedBody({
      tokenId,
      newUri,
    }),
  });
}

export const FIXTURE_BLOCK_ENTITY_MINT = {
  slot: 500_001,
  transactions: [
    {
      signature: "fixtureSigMint111111111111111111111111111111111111111111111",
      metaErr: null,
      logMessages: [
        `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
        passportMintedProgramDataLine(),
        `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
      ],
    },
  ],
};

export const FIXTURE_METADATA_JSON = {
  vin: "SVMFIXTUREVIN001",
  make: "Fixture",
  model: "SVM",
  year: 2024,
  mileageKm: 12000,
  fuelType: "electric",
  bodyType: "sedan",
  transmission: "automatic",
  condition: "used",
  vehicleType: "car",
  colour: "blue",
  coverPhotoUri: "ar://fixture-cover",
  locationPlaceId: "place-fixture-1",
};

export function fixtureMetadataFetcher() {
  return async (uri: string) => ({
    status: "captured" as const,
    rawJson: { ...FIXTURE_METADATA_JSON, uri },
    denorm: {
      vin: FIXTURE_METADATA_JSON.vin,
      make: FIXTURE_METADATA_JSON.make,
      model: FIXTURE_METADATA_JSON.model,
      year: FIXTURE_METADATA_JSON.year,
      mileageKm: FIXTURE_METADATA_JSON.mileageKm,
      fuelType: FIXTURE_METADATA_JSON.fuelType,
      bodyType: FIXTURE_METADATA_JSON.bodyType,
      transmission: FIXTURE_METADATA_JSON.transmission,
      condition: FIXTURE_METADATA_JSON.condition,
      vehicleType: FIXTURE_METADATA_JSON.vehicleType,
      colour: FIXTURE_METADATA_JSON.colour,
      coverPhotoUri: FIXTURE_METADATA_JSON.coverPhotoUri,
      locationLabel: "",
      locationPlaceId: FIXTURE_METADATA_JSON.locationPlaceId,
      locationCountryCode: "",
    },
  });
}

export const FIXTURE_BLOCK = {
  slot: 500_000,
  transactions: [
    {
      signature: "fixtureSig111111111111111111111111111111111111111111111111111111",
      metaErr: null,
      logMessages: [
        `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
        passportMintedProgramDataLine(),
        `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
      ],
    },
  ],
};

export const FIXTURE_BLOCK_PROVENANCE = {
  slot: 500_010,
  transactions: [
    {
      signature: "fixtureSigProv111111111111111111111111111111111111111111111111",
      metaErr: null,
      logMessages: [
        `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
        recordAppendedProgramDataLine(),
        passportUriUpdatedProgramDataLine(),
        `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
      ],
    },
  ],
};

/** Second URI update on the same token — exercises cross-block inline replay state. */
export const FIXTURE_BLOCK_URI_V2 = {
  slot: 500_011,
  transactions: [
    {
      signature: "fixtureSigUriV2111111111111111111111111111111111111111111111111",
      metaErr: null,
      logMessages: [
        `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
        passportUriUpdatedProgramDataLine(FIXTURE_TOKEN_ID, "ar://svm-uri-v2"),
        `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
      ],
    },
  ],
};

export const FIXTURE_BLOCK_UNKNOWN_DISC = {
  slot: 500_001,
  transactions: [
    {
      signature: "fixtureSig222222222222222222222222222222222222222222222222222222",
      metaErr: null,
      logMessages: [
        `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
        `Program data: ${Buffer.from("deadbeefdeadbeef0102030405060708", "hex").toString("base64")}`,
        `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
      ],
    },
  ],
};
