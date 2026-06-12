"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

/** False during SSR / first paint; true after client hydration (no effect + setState). */
export function useClientMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
