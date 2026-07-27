import { formatPassportShortLabel } from "@/lib/passport/passport-token-id";

/** Human vehicle line from optional year / make / model. Partials allowed; all empty → `""`. */
export function buildVehicleLabel(
  year: number | null | undefined,
  make: string | null | undefined,
  model: string | null | undefined,
): string {
  const parts: string[] = [];
  if (year != null && year > 0) parts.push(String(year));
  const makeTrimmed = typeof make === "string" ? make.trim() : "";
  const modelTrimmed = typeof model === "string" ? model.trim() : "";
  if (makeTrimmed) parts.push(makeTrimmed);
  if (modelTrimmed) parts.push(modelTrimmed);
  return parts.join(" ");
}

/**
 * Profile / inventory title: prefer vehicle label; else `Vehicle #n · Chain`
 * (same fallback contract as listing `buildTitle`).
 */
export function buildProfilePassportTitle(input: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  tokenId: string;
  chainId: number;
}): string {
  const label = buildVehicleLabel(input.year, input.make, input.model);
  if (label) return label;
  return `Vehicle ${formatPassportShortLabel(input.tokenId, input.chainId)}`;
}
