import type { PassportStatus } from "@/lib/types/ponder";

export const STATUS_FROM_CHAIN: Record<number, PassportStatus> = {
  0: "UNVERIFIED",
  1: "VERIFIED",
  2: "DISPUTED",
};

export function passportStatusFromChainIndex(index: number): PassportStatus | null {
  return STATUS_FROM_CHAIN[index] ?? null;
}
