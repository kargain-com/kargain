"use server";

import {
  mapChallengeRows,
  type ChallengeInstance,
  type ChallengeRecord,
  type ChallengeStatus,
  type PonderChallengeRow,
} from "@/lib/commerce/ponder-consignment";
import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type ChallengesPage = {
  ok: true;
  rows: ChallengeRecord[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: "PONDER_UNAVAILABLE";
};

type ChallengesResponse = {
  challenges?: PonderChallengeRow[];
  total?: number;
  page?: number;
  limit?: number;
};

export type ChallengeQuery = {
  instance?: ChallengeInstance;
  /** Single status or CSV (`open,judged`) — expanded by browse-filters owner. */
  status?: ChallengeStatus | string;
  challenger?: string;
  subjectId?: string;
  page?: number;
  limit?: number;
};

function emptyPage(page: number): ChallengesPage {
  return {
    ok: true,
    rows: [],
    total: 0,
    page,
    totalPages: 0,
    ponderError: "PONDER_UNAVAILABLE",
  };
}

export async function getChallenges(
  query: ChallengeQuery = {},
): Promise<ChallengesPage> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 24;

  try {
    const url = buildPonderUrl(
      "challenges.list",
      {},
      {
        page,
        limit,
        instance: query.instance,
        status: query.status,
        challenger: query.challenger,
        subjectId: query.subjectId,
      },
    );

    const res = await ponderFetch("challenges", url.toString());
    if (!res.ok) return emptyPage(page);

    const data = res.body as ChallengesResponse;
    const rows = mapChallengeRows(data.challenges);
    const total = data.total ?? rows.length;

    return {
      ok: true,
      rows,
      total,
      page: data.page ?? page,
      totalPages: Math.max(1, Math.ceil(total / (data.limit || limit))),
    };
  } catch {
    return emptyPage(page);
  }
}
