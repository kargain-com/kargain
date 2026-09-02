"use client";

import { usePassportCommerceFacts } from "@/hooks/use-passport-commerce-facts";
import {
  derivePassportPresence,
  derivePassportTrustDisplay,
  passportAwayActionCopy,
  type PassportPresence,
  type PassportTrustDisplay,
} from "@/lib/passport/presence";
import type { PassportStatus } from "@/lib/types/ponder";

export type UsePassportPresenceInput = {
  readonly chainId: number;
  readonly tokenId: string;
  readonly ponderCustodyChain: number | null;
  readonly custodyUnresolved?: string | null;
  /**
   * When false, skip the lock read. Pass only when the read is intentionally
   * not performed — `custodyLocked` stays `undefined` (honest “not read”).
   * Default: read when custody is known and there is no fold cause (fold wins
   * inside the deriver; skipping the RPC is still “not read”, not “unlocked”).
   */
  readonly readCustodyLock?: boolean;
};

/**
 * Client chrome owner for passport location — sole hook that may call
 * `derivePassportPresence`. Never invents an unlocked lock read.
 */
export function usePassportPresence(input: UsePassportPresenceInput): {
  readonly presence: PassportPresence;
  readonly presenceCopy: string;
  trustDisplay: (recordedStatus: PassportStatus) => PassportTrustDisplay;
} {
  const foldPresent = Boolean(input.custodyUnresolved);
  const shouldReadLock =
    input.readCustodyLock ??
    (input.ponderCustodyChain != null && !foldPresent);

  const facts = usePassportCommerceFacts({
    chainId: input.chainId,
    tokenId: input.tokenId,
    enabled: shouldReadLock,
  });

  // When the lock read is skipped or still pending, leave undefined — never false.
  const custodyLocked = shouldReadLock ? facts.custodyLocked : undefined;

  const presence = derivePassportPresence({
    viewChainId: input.chainId,
    custodyLocked,
    ponderCustodyChain: input.ponderCustodyChain,
    custodyUnresolved: input.custodyUnresolved ?? null,
  });

  return {
    presence,
    presenceCopy: passportAwayActionCopy(presence),
    trustDisplay: (recordedStatus) =>
      derivePassportTrustDisplay(presence, recordedStatus),
  };
}
