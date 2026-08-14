/**
 * Branded Ponder identity types — passport token ids and consignment append-only
 * ids are not interchangeable (commerce-cutover invariant).
 */

export type PassportTokenId = string & { readonly __brand: "PassportTokenId" };
export type ConsignmentId = string & { readonly __brand: "ConsignmentId" };

export function asPassportTokenId(value: string): PassportTokenId {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("PassportTokenId: empty");
  return trimmed as PassportTokenId;
}

export function asConsignmentId(value: string): ConsignmentId {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("ConsignmentId: empty");
  return trimmed as ConsignmentId;
}

/** Soft coerce for trust boundaries that already validated digit/token shape. */
export function passportTokenIdFromUnknown(value: string): PassportTokenId {
  return asPassportTokenId(value);
}

export function consignmentIdFromUnknown(value: string): ConsignmentId {
  return asConsignmentId(value);
}
