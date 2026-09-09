/**
 * Sole vocabulary for passport entity mint-observation discriminant.
 * Declared on both EVM Ponder and SVM projection arms — never inferred from empty fields.
 */

export const PASSPORT_ENTITY_ORIGINS = ["minted", "pre_mint"] as const;

export type PassportEntityOrigin = (typeof PASSPORT_ENTITY_ORIGINS)[number];

export const PASSPORT_ENTITY_ABSENCES = [
  "not_found",
  "not_indexed",
  "read_path_unavailable",
] as const;

export type PassportEntityAbsence = (typeof PASSPORT_ENTITY_ABSENCES)[number];

export function isPassportEntityOrigin(value: unknown): value is PassportEntityOrigin {
  return (
    typeof value === "string" &&
    (PASSPORT_ENTITY_ORIGINS as readonly string[]).includes(value)
  );
}

export function parsePassportEntityOrigin(value: unknown): PassportEntityOrigin {
  if (!isPassportEntityOrigin(value)) {
    throw new Error(
      `passport_entity_origin_unlabeled: ${value == null ? String(value) : JSON.stringify(value)}`,
    );
  }
  return value;
}

export function isPassportEntityAbsence(value: unknown): value is PassportEntityAbsence {
  return (
    typeof value === "string" &&
    (PASSPORT_ENTITY_ABSENCES as readonly string[]).includes(value)
  );
}
