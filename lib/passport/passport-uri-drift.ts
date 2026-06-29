import type { PassportMetadata } from "@/lib/passport/metadata-schema";
import type { PonderPassportDetail } from "@/lib/types/ponder";

export function hasTokenUriDrift(ponderUri: string, chainUri: string | null): boolean {
  const ponder = ponderUri.trim();
  const chain = (chainUri ?? "").trim();
  return Boolean(chain && chain !== ponder);
}

export function effectiveTokenUri(ponderUri: string, chainUri: string | null): string {
  const ponder = ponderUri.trim();
  const chain = (chainUri ?? "").trim();
  return chain && chain !== ponder ? chain : ponder;
}

export function overlayPassportFromMetadata(
  passport: PonderPassportDetail,
  metadata: PassportMetadata,
  tokenUri: string,
): PonderPassportDetail {
  return {
    ...passport,
    tokenUri,
    vin: metadata.vin,
    make: metadata.make,
    model: metadata.model,
    year: metadata.year ?? 0,
    mileageKm: metadata.mileageKm ?? 0,
    fuelType: metadata.fuelType ?? "",
    bodyType: metadata.bodyType ?? "",
    transmission: metadata.transmission ?? "",
  };
}
