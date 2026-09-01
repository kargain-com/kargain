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

/** PassportMinted discriminator + 32-byte tokenId body (all zero). */
export function passportMintedProgramDataLine(): string {
  const disc = Buffer.from("c432456ccb330992", "hex");
  const body = Buffer.alloc(32, 0);
  const payload = Buffer.concat([disc, body]);
  return `Program data: ${payload.toString("base64")}`;
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
