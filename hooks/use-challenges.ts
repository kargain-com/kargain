"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getChallenges,
  type ChallengeQuery,
} from "@/app/actions/commerce-challenges";

export function challengesQueryKey(query: ChallengeQuery = {}) {
  return [
    "challenges",
    query.instance ?? "all",
    query.status ?? "all",
    query.unresolved ? "unresolved" : "any",
    query.challenger?.toLowerCase() ?? "",
    query.subjectId ?? "",
    query.page ?? 1,
    query.limit ?? 24,
  ] as const;
}

export function useChallenges(query: ChallengeQuery = {}, enabled = true) {
  return useQuery({
    queryKey: challengesQueryKey(query),
    queryFn: () => getChallenges(query),
    enabled,
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
