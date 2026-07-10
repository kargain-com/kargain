"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { checkXmtpReachable } from "@/lib/xmtp/can-message-peer";
import {
  getCachedNetworkRegistered,
  isMessagingDisabledLocally,
  setNetworkRegisteredCache,
  setOptedIn,
} from "@/lib/xmtp/messaging-preferences";
import { shouldRestartNetworkCheck } from "@/lib/xmtp/should-restart-network-check";

type NetworkRegistrationStore = {
  address: string | null;
  freshRegistered: boolean | null;
  networkChecking: boolean;
  networkChecked: boolean;
};

let store: NetworkRegistrationStore = {
  address: null,
  freshRegistered: null,
  networkChecking: false,
  networkChecked: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setStore(partial: Partial<NetworkRegistrationStore>) {
  store = { ...store, ...partial };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return store;
}

let checkGeneration = 0;

async function runNetworkCheck(address: `0x${string}`): Promise<void> {
  const generation = ++checkGeneration;
  setStore({
    address: address.toLowerCase(),
    networkChecking: true,
    networkChecked: false,
  });

  try {
    const registered = await checkXmtpReachable(address);
    if (generation !== checkGeneration) return;

    setStore({
      freshRegistered: registered,
      networkChecking: false,
      networkChecked: true,
    });

    if (registered) {
      setNetworkRegisteredCache(address);
      if (!isMessagingDisabledLocally(address)) {
        setOptedIn(address);
      }
    }
  } catch {
    if (generation !== checkGeneration) return;
    setStore({
      freshRegistered: false,
      networkChecking: false,
      networkChecked: true,
    });
  }
}

function resetNetworkCheck(address: `0x${string}` | undefined) {
  if (!address) {
    checkGeneration += 1;
    setStore({
      address: null,
      freshRegistered: null,
      networkChecking: false,
      networkChecked: true,
    });
    return;
  }

  const key = address.toLowerCase();
  if (!shouldRestartNetworkCheck(store, key)) return;

  setStore({
    address: key,
    freshRegistered: null,
    networkChecking: true,
    networkChecked: false,
  });
  void runNetworkCheck(address);
}

export function useXmtpNetworkRegistration(address: `0x${string}` | undefined): {
  networkRegistered: boolean;
  networkChecking: boolean;
  refetchNetwork: () => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    resetNetworkCheck(address);
  }, [address]);

  const cachedRegistered = address ? getCachedNetworkRegistered(address) : false;
  const addressKey = address?.toLowerCase() ?? null;
  const storeMatches = snapshot.address === addressKey;

  const freshRegistered = storeMatches ? snapshot.freshRegistered : null;
  // Fresh negative/failed checks do not clear a valid cache hit — XMTP registration is
  // effectively permanent and the catch path cannot distinguish outage from a true negative.
  const networkRegistered = freshRegistered === true || cachedRegistered;

  const networkChecking =
    Boolean(address) &&
    (!storeMatches || snapshot.networkChecking || !snapshot.networkChecked);

  const refetchNetwork = useCallback(() => {
    if (!address) return;
    void runNetworkCheck(address);
  }, [address]);

  return {
    networkRegistered,
    networkChecking,
    refetchNetwork,
  };
}
