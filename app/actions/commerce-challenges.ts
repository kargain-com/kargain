"use server";

import {
  mapChallengeRows,
  type ChallengeInstance,
  type ChallengeRecord,
  type ChallengeStatus,
  type PonderChallengeRow,
} from "@/lib/commerce/ponder-consignment";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

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
  status?: ChallengeStatus;
  /** `open` + `judged` — anything still awaiting a terminal action. */
  unresolved?: boolean;
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
    const url = new URL(`${ponderBaseUrl()}/challenges`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (query.instance) url.searchParams.set("instance", query.instance);
    if (query.status) url.searchParams.set("status", query.status);
    if (query.unresolved) url.searchParams.set("unresolved", "true");
    if (query.challenger) url.searchParams.set("challenger", query.challenger);
    if (query.subjectId) url.searchParams.set("subjectId", query.subjectId);

    const res = await ponderFetch(url.toString());
    if (!res.ok) return emptyPage(page);

    const data = (await res.json()) as ChallengesResponse;
    let rows = mapChallengeRows(data.challenges);
    if (query.unresolved) {
      rows = rows.filter(
        (row) => row.status === "open" || row.status === "judged",
      );
    }
    const total = query.unresolved ? rows.length : (data.total ?? rows.length);

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
