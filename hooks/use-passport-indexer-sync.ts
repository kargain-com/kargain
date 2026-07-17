"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getPassportDetail } from "@/app/actions/passport-detail";
import {
  KAR_PRO_VERIFIER_POLL_INTERVAL_MS,
  KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS,
} from "@/lib/kar-pro/kar-pro-verifier-profile";
import { pollUntil } from "@/lib/web3/tx-sync";

type PassportDetailResult = Awaited<ReturnType<typeof getPassportDetail>>;
type PassportPollStatus = "idle" | "polling" | "matched" | "exhausted";

function foregroundWait(
  ms: number,
  isActive: () => boolean,
  registerCancel: (cancel: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resolve();
    };
    const onVisibilityChange = () => {
      if (!isActive()) {
        finish();
      } else if (document.visibilityState === "hidden") {
        if (timeout) clearTimeout(timeout);
        timeout = undefined;
      } else {
        finish();
      }
    };

    registerCancel(finish);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!isActive() || document.visibilityState === "hidden") return;
    timeout = setTimeout(finish, ms);
  });
}

export function usePassportIndexerPoll(
  tokenId: string,
  chainId: number,
  enabled = true,
) {
  const pollKey = `${chainId}:${tokenId}:${enabled ? "on" : "off"}`;
  const [state, setState] = useState<{
    key: string;
    latest?: PassportDetailResult;
    status: PassportPollStatus;
  }>(() => ({
    key: pollKey,
    status: enabled ? "polling" : "idle",
  }));
  if (state.key !== pollKey) {
    setState({
      key: pollKey,
      status: enabled ? "polling" : "idle",
    });
  }
  const current =
    state.key === pollKey
      ? state
      : {
          key: pollKey,
          status: enabled ? ("polling" as const) : ("idle" as const),
        };

  useEffect(() => {
    let active = true;
    const cancelWaits = new Set<() => void>();
    if (!enabled) return;

    void pollUntil({
      poll: async () => {
        const result = await getPassportDetail(tokenId, chainId);
        if (active) {
          setState((previous) =>
            previous.key === pollKey
              ? { ...previous, latest: result }
              : previous,
          );
        }
        return result;
      },
      predicate: (result) => result.ok && !result.indexerPending,
      intervalMs: KAR_PRO_VERIFIER_POLL_INTERVAL_MS,
      maxAttempts: KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS,
      wait: (ms) =>
        foregroundWait(
          ms,
          () => active,
          (cancel) => cancelWaits.add(cancel),
        ),
      shouldContinue: () => active,
    }).then((result) => {
      if (!active) return;
      setState((previous) =>
        previous.key === pollKey
          ? {
              ...previous,
              status:
                result.status === "matched" ? "matched" : "exhausted",
            }
          : previous,
      );
    });

    return () => {
      active = false;
      for (const cancel of cancelWaits) cancel();
      cancelWaits.clear();
    };
  }, [chainId, enabled, pollKey, tokenId]);

  return { latest: current.latest, status: current.status };
}

export function usePassportIndexerSync(
  tokenId: string,
  chainId: number,
  enabled: boolean,
) {
  const router = useRouter();
  const { latest, status } = usePassportIndexerPoll(
    tokenId,
    chainId,
    enabled,
  );

  useEffect(() => {
    if (status === "matched") router.refresh();
  }, [router, status]);

  const isSyncing =
    enabled && Boolean(latest?.ok && latest.indexerPending);

  return { isSyncing };
}
