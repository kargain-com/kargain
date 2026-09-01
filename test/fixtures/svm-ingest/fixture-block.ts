import {
  buildPassportUriUpdatedBody,
  buildProgramDataLine,
  buildRecordAppendedBody,
  globalTokenId,
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

/** PassportMinted discriminator + 32-byte tokenId body (all zero). */
export function passportMintedProgramDataLine(): string {
  const disc = Buffer.from("c432456ccb330992", "hex");
  const body = Buffer.alloc(32, 0);
  const payload = Buffer.concat([disc, body]);
  return `Program data: ${payload.toString("base64")}`;
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
