"use server";

import type { ObligationFacts } from "@/lib/obligation";
import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type ObligationsFactsResponse = ObligationFacts & {
  address: string;
};

export type GetObligationsResult =
  | { ok: true; facts: ObligationFacts }
  | { ok: false; facts: ObligationFacts };

const UNRESOLVED_FACTS: ObligationFacts = {
  unresolved: true,
  consignments: [],
  holds: [],
  bids: [],
  challenges: [],
  passports: [],
  modes: [],
};

export async function getAccountObligations(
  address: string,
): Promise<GetObligationsResult> {
  try {
    const res = await ponderFetch(
      buildPonderUrl("accounts.obligations", { address }).toString(),
    );
    if (!res.ok) {
      return { ok: false, facts: UNRESOLVED_FACTS };
    }
    const body = (await res.json()) as ObligationsFactsResponse;
    const {
      unresolved,
      consignments,
      holds,
      bids,
      challenges,
      passports,
      modes,
    } = body;
    return {
      ok: !unresolved,
      facts: {
        unresolved: Boolean(unresolved),
        consignments: consignments ?? [],
        holds: holds ?? [],
        bids: bids ?? [],
        challenges: challenges ?? [],
        passports: passports ?? [],
        modes: modes ?? [],
      },
    };
  } catch {
    return { ok: false, facts: UNRESOLVED_FACTS };
  }
}
