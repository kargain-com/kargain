/**
 * Physical column names on Ponder 0.16 `DATABASE_SCHEMA=kargain` tables.
 * Captured from information_schema on a Ponder-created Postgres instance
 * (e2e: postgres:16-alpine + ponder:dev). JS schema fields remain camelCase.
 */

export const KARGAIN_PASSPORT_PHYSICAL_COLUMNS = [
  "id",
  "chain_id",
  "owner",
  "status",
  "verifier",
  "verified_at",
  "token_uri",
  "cover_photo_uri",
  "vin",
  "make",
  "model",
  "year",
  "mileage_km",
  "last_disputer",
  "dispute_reason",
  "dispute_withdrawn_at",
  "last_verification_reset_at",
  "duplicate_vin",
  "last_metadata_change_at",
  "verification_reset_count",
  "had_dispute",
  "last_dispute_resolved_at",
  "last_dispute_terminal",
  "dispute_opened_at",
  "fuel_type",
  "body_type",
  "transmission",
  "condition",
  "vehicle_type",
  "colour",
  "location_label",
  "location_place_id",
  "location_country_code",
  "dispute_deposit",
  "created_at",
  "updated_at",
] as const;

export const KARGAIN_CONSIGNMENT_PHYSICAL_COLUMNS = [
  "id",
  "chain_id",
  "mode",
  "mode_contract",
  "token_id",
  "sale_ordinal",
  "seller",
  "agent",
  "asset",
  "denomination_kind",
  "currency_code",
  "floor",
  "compensation_form",
  "commission_bps",
  "price",
  "platform_fee_bps",
  "phase",
  "close_reason",
  "opened_at",
  "closed_at",
  "recall_requested_at",
  "buyer",
  "settlement_note_set_at",
  "settlement_note_setter",
  "open_tx_hash",
  "open_log_index",
  "updated_at",
] as const;

export const KARGAIN_CUSTODY_DETERMINING_PHYSICAL_COLUMNS = [
  "id",
  "token_id",
  "chain_id",
  "kind",
  "block_number",
  "log_index",
  "tx_hash",
  "timestamp",
] as const;

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
