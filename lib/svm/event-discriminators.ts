/**
 * Structural discriminator lookup — generated from events.manifest.json (no borsh decode).
 */

import discriminatorsJson from "./discriminators.json" with { type: "json" };

export type DiscriminatorContractEntry = {
  contract: string;
  event: string;
};

export type DiscriminatorEntry = {
  discriminatorHex: string;
  contracts: DiscriminatorContractEntry[];
};

const ENTRIES: readonly DiscriminatorEntry[] = discriminatorsJson.entries;

const BY_HEX = new Map<string, DiscriminatorEntry>(
  ENTRIES.map((e) => [e.discriminatorHex, e]),
);

/** Map commercial program slug → Solidity contract family name. */
export const PROGRAM_SLUG_TO_CONTRACT: Record<string, string> = {
  "kar-passport": "KarPassport",
  "kar-pro-staking": "KarProStaking",
  "kar-pro-pass": "KarProPass",
  "kar-fixed-price": "FixedPriceConsignment",
  "kar-ascending": "AscendingConsignment",
  "kar-gateway": "KarPassportBridgeGateway",
};

export function lookupEventForProgram(args: {
  discriminator: Buffer;
  contractName: string;
}): { event: string; contract: string } | null {
  if (args.discriminator.length < 8) return null;
  const hex = args.discriminator.subarray(0, 8).toString("hex");
  const entry = BY_HEX.get(hex);
  if (!entry) return null;
  const match = entry.contracts.find((c) => c.contract === args.contractName);
  return match ?? null;
}

export function splitDiscriminatorAndBody(payloadBytes: Buffer): {
  discriminator: Buffer;
  body: Buffer;
} | null {
  if (payloadBytes.length < 8) return null;
  return {
    discriminator: payloadBytes.subarray(0, 8),
    body: payloadBytes.subarray(8),
  };
}

export function contractNameForProgramSlug(slug: string): string | null {
  return PROGRAM_SLUG_TO_CONTRACT[slug] ?? null;
}

export function allDiscriminatorEntries(): readonly DiscriminatorEntry[] {
  return ENTRIES;
}
