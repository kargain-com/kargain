/**
 * Physical column names on Ponder 0.16 `DATABASE_SCHEMA=kargain` tables.
 *
 * Ponder hardcodes Drizzle `casing: "snake_case"` (see `ponder/dist/.../database/index.js`
 * and `onchain.js` `toSnakeCase(name)`). Measured 2026-09-03 against a
 * Ponder-created Postgres (`DATABASE_SCHEMA=kargain`):
 *   information_schema.columns for kargain.passport includes `chain_id`
 *   (not `chainId`); `SELECT "chainId" FROM kargain.passport` →
 *   ERROR: column "chainId" does not exist.
 *
 * Do not confuse with:
 * - JS schema fields in ponder.schema.ts (`chainId`) — API / Drizzle keys
 * - PASSPORT_BROWSE_INDEXES.column — same JS field names for Drizzle browse
 * - HTTP JSON wire (`"chainId"`) — result aliases, not physical columns
 *
 * Production master `/consignments` uses Drizzle (`ponder-consignment-browse.ts`),
 * which maps JS → physical via the same casing. Raw `c."chainId"` SQL never
 * shipped on master; it lived only on the SVM port branch and was wrong against
 * a Ponder 0.16 database.
 */

/** Same algorithm as drizzle-orm `toSnakeCase` (Ponder 0.16 dependency). */
export function ponderPhysicalColumnName(jsField: string): string {
  const words =
    jsField.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ??
    [];
  return words.map((word) => word.toLowerCase()).join("_");
}

/**
 * JS field names on `passport` in ponder.schema.ts (order matches schema).
 * Physical PG names = map through ponderPhysicalColumnName.
 */
export const PASSPORT_JS_FIELDS = [
  "id",
  "chainId",
  "owner",
  "status",
  "verifier",
  "verifiedAt",
  "tokenUri",
  "coverPhotoUri",
  "vin",
  "make",
  "model",
  "year",
  "mileageKm",
  "lastDisputer",
  "disputeReason",
  "disputeWithdrawnAt",
  "lastVerificationResetAt",
  "duplicateVin",
  "lastMetadataChangeAt",
  "verificationResetCount",
  "hadDispute",
  "lastDisputeResolvedAt",
  "lastDisputeTerminal",
  "disputeOpenedAt",
  "fuelType",
  "bodyType",
  "transmission",
  "condition",
  "vehicleType",
  "colour",
  "locationLabel",
  "locationPlaceId",
  "locationCountryCode",
  "disputeDeposit",
  "createdAt",
  "updatedAt",
] as const;

export const CONSIGNMENT_JS_FIELDS = [
  "id",
  "chainId",
  "mode",
  "modeContract",
  "tokenId",
  "saleOrdinal",
  "seller",
  "agent",
  "asset",
  "denominationKind",
  "currencyCode",
  "floor",
  "compensationForm",
  "commissionBps",
  "price",
  "platformFeeBps",
  "phase",
  "closeReason",
  "openedAt",
  "closedAt",
  "recallRequestedAt",
  "buyer",
  "settlementNoteSetAt",
  "settlementNoteSetter",
  "openTxHash",
  "openLogIndex",
  "updatedAt",
] as const;

export const CUSTODY_DETERMINING_JS_FIELDS = [
  "id",
  "tokenId",
  "chainId",
  "kind",
  "blockNumber",
  "logIndex",
  "txHash",
  "timestamp",
] as const;

export const KARGAIN_PASSPORT_PHYSICAL_COLUMNS = PASSPORT_JS_FIELDS.map(
  ponderPhysicalColumnName,
);

export const KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS = CONSIGNMENT_JS_FIELDS.map(
  ponderPhysicalColumnName,
);

export const KARGAIN_CUSTODY_DETERMINING_PHYSICAL_COLUMNS =
  CUSTODY_DETERMINING_JS_FIELDS.map(ponderPhysicalColumnName);

/**
 * Historical raw browse fragment from the SVM-port branch before S8-5-fix
 * (never on master). Against Ponder 0.16 physical schema this is red.
 */
export const HISTORICAL_CAMELCASE_BROWSE_FRAGMENT = `c."chainId" AS "chainId",
  c."denominationKind" AS "denominationKind"`;

/**
 * Quoted camelCase used as a physical column (`c."chainId"` or
 * `SELECT …, "chainId"`), not result aliases (`AS "chainId"`) and not
 * TypeScript string literals.
 */
export function findQuotedCamelCaseSqlIdentifiers(sql: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\."([A-Za-z][A-Za-z0-9]*)"/g,
    /(?:SELECT|,)\s*"([A-Za-z][A-Za-z0-9]*)"/g,
  ];
  for (const re of patterns) {
    for (const match of sql.matchAll(re)) {
      const name = match[1]!;
      if (/[a-z][A-Z]/.test(name)) found.add(name);
    }
  }
  return [...found].sort();
}

export function extractSelectListBeforeFrom(
  sql: string,
  fromRelation: string,
): string[] {
  const escaped = fromRelation.replaceAll(".", "\\.");
  const match =
    sql.match(
      new RegExp(
        `PASSPORT_ENTITY_EVM_SELECT = \`SELECT\\s+([\\s\\S]*?)FROM\\s+${escaped}\``,
      ),
    ) ??
    sql.match(
      new RegExp(`SELECT\\s+([\\s\\S]*?)\\s+FROM\\s+${escaped}(?:\\s|;|$)`, "i"),
    );
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((part) => {
      const expr = part.trim().split(/\s+AS\s+/i)[0]!.trim();
      return expr.replace(/^c\./, "").replace(/^p\./, "").replaceAll('"', "");
    })
    .filter((name) => name.length > 0 && name !== "*");
}

export function columnSetMismatch(
  actual: readonly string[],
  expected: readonly string[],
): { missing: string[]; extra: string[] } {
  const want = new Set(expected);
  const got = new Set(actual);
  return {
    missing: [...want].filter((c) => !got.has(c)).sort(),
    extra: [...got].filter((c) => !want.has(c)).sort(),
  };
}
