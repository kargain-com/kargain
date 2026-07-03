"use client";

import { useEffect, useState } from "react";

import { LISTING_CHAIN_STATUS_CONFIRM_IDLE_TIMEOUT_MS } from "@/lib/marketplace/listing-chain-status-confirm-fetch";

export function useDeferListingChainStatusConfirm() {
  const [deferReady, setDeferReady] = useState(false);

  useEffect(() => {
    if (deferReady) return;

    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setDeferReady(true);
    };

    const onScroll = () => {
      window.removeEventListener("scroll", onScroll, scrollOptions);
      markReady();
    };
    const scrollOptions: AddEventListenerOptions = { passive: true };
    window.addEventListener("scroll", onScroll, scrollOptions);

    let idleId: number | undefined;
    let timeoutId: number | undefined;

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(markReady, {
        timeout: LISTING_CHAIN_STATUS_CONFIRM_IDLE_TIMEOUT_MS,
      });
    } else {
      timeoutId = window.setTimeout(markReady, LISTING_CHAIN_STATUS_CONFIRM_IDLE_TIMEOUT_MS);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll, scrollOptions);
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [deferReady]);

  return deferReady;
}
