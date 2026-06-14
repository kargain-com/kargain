import type { PassportStatus, PonderPassportDetail } from "@/lib/types/ponder";

export function needsBuyRiskAck(params: {
  passportStatus: PassportStatus;
  duplicateVin: boolean;
}): boolean {
  return (
    params.passportStatus === "UNVERIFIED" ||
    params.passportStatus === "DISPUTED" ||
    params.duplicateVin
  );
}

export function showFixedAfterDisputeBanner(
  passport: Pick<
    PonderPassportDetail,
    | "hadDispute"
    | "status"
    | "lastMetadataChangeAt"
    | "lastVerificationResetAt"
    | "lastDisputeResolvedAt"
  >,
): boolean {
  if (!passport.hadDispute || passport.status !== "UNVERIFIED") return false;

  const meta = BigInt(passport.lastMetadataChangeAt || "0");
  if (meta <= 0n) return false;

  const reset = BigInt(passport.lastVerificationResetAt || "0");
  const resolved = BigInt(passport.lastDisputeResolvedAt || "0");

  if (reset > 0n && meta > reset) return true;
  if (resolved > 0n && meta > resolved) return true;

  return false;
}
