/**
 * Sole Challenges browse filter owner — chip → Ponder query.
 * Unresolved predicate stays {@link isChallengeUnresolved}; this module
 * only maps filters and expands that predicate to status SQL (CSV / IN).
 */

import { isChallengeUnresolved } from "@/lib/commerce/challenge-display";
import type {
  ChallengeInstance,
  ChallengeStatus,
} from "@/lib/commerce/ponder-consignment";

export type ChallengeBrowseFilterId =
  | "unresolved"
  | "passport"
  | "ascending"
  | "mine";

export const CHALLENGE_BROWSE_FILTER_OPTIONS: {
  id: ChallengeBrowseFilterId;
  label: string;
}[] = [
  { id: "unresolved", label: "Needs action" },
  { id: "passport", label: "Verification" },
  { id: "ascending", label: "Auction settlement" },
  { id: "mine", label: "Opened by me" },
];

const ALL_CHALLENGE_STATUSES: readonly ChallengeStatus[] = [
  "open",
  "withdrawn",
  "judged",
  "concluded",
];

/** Statuses that {@link isChallengeUnresolved} accepts — sole expansion for SQL. */
export function challengeUnresolvedStatuses(): ChallengeStatus[] {
  return ALL_CHALLENGE_STATUSES.filter(isChallengeUnresolved);
}

export type ChallengeBrowseQueryParams = {
  instance?: ChallengeInstance;
  /** Single status or CSV for SQL `IN` (e.g. `open,judged`). */
  status?: string;
  challenger?: string;
};

export type ChallengeBrowseQueryResult =
  | { ok: true; query: ChallengeBrowseQueryParams }
  | { ok: false; reason: "viewer_required" };

/**
 * Map a Challenges chrome chip to GET /challenges query keys.
 * Mine requires a connected viewer address (server `challenger=`).
 */
export function challengeBrowseFilterToQuery(
  filter: ChallengeBrowseFilterId,
  viewerAddress?: string | null,
): ChallengeBrowseQueryResult {
  switch (filter) {
    case "unresolved":
      return {
        ok: true,
        query: { status: challengeUnresolvedStatuses().join(",") },
      };
    case "passport":
      return { ok: true, query: { instance: "passport" } };
    case "ascending":
      return { ok: true, query: { instance: "ascending" } };
    case "mine": {
      const addr = viewerAddress?.trim();
      if (!addr) return { ok: false, reason: "viewer_required" };
      return { ok: true, query: { challenger: addr } };
    }
  }
}

/** Parse `status` query (single or CSV). Unknown token → null (handler 400). */
export function parseChallengeStatusFilter(
  raw: string | undefined,
): ChallengeStatus[] | null | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const allowed = new Set<string>(ALL_CHALLENGE_STATUSES);
  const out: ChallengeStatus[] = [];
  for (const part of trimmed.split(",")) {
    const s = part.trim();
    if (!s) continue;
    if (!allowed.has(s)) return null;
    out.push(s as ChallengeStatus);
  }
  return out.length > 0 ? out : undefined;
}
