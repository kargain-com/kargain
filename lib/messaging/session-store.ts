import type {
  CreateMessagingSession,
  CreateMessagingSessionInput,
  MessagingSession,
  SessionCommand,
  SessionSnapshot,
} from "./ports";
import {
  createInMemoryMessagingCache,
  createMessagingCachePort,
} from "./adapters/cache-adapter";
import { getMessagingXmtpEnv } from "./xmtp-env";
import { createEffectsRunner, getSessionSnapshot } from "./effects";
import { unbrandClient } from "./adapters/xmtp-adapter";

export const createMessagingSession: CreateMessagingSession = (
  input: CreateMessagingSessionInput,
): MessagingSession => {
  const cache =
    input.cache ??
    (typeof localStorage === "undefined"
      ? createInMemoryMessagingCache()
      : createMessagingCachePort(getMessagingXmtpEnv()));
  const listeners = new Set<() => void>();

  const runner = createEffectsRunner({
    address: input.address,
    ports: input.ports,
    clock: input.clock,
    cache,
    onChange: () => {
      for (const listener of listeners) listener();
    },
  });

  let started = false;

  function syncWalletAddress() {
    const walletAddress = input.ports.wallet.getAddress();
    const sessionAddress = runner.getState().address;
    if (walletAddress && walletAddress.toLowerCase() !== sessionAddress.toLowerCase()) {
      runner.onAddressChange(walletAddress);
    }
  }

  function snapshotNow(): SessionSnapshot {
    return getSessionSnapshot(runner.getState(), input.ports, input.clock.nowMs());
  }

  return {
    getSnapshot() {
      return snapshotNow();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    dispatch(command: SessionCommand) {
      syncWalletAddress();
      const current = snapshotNow();
      if (current.state === "disconnected" || current.state === "unsupported") {
        return;
      }
      runner.dispatch(command);
    },
    getXmtpClient() {
      syncWalletAddress();
      const client = runner.getState().localClient;
      return client ? unbrandClient(client) : null;
    },
    start() {
      if (started) return;
      started = true;
      runner.start();
    },
    syncWalletAddress,
    dispose() {
      runner.dispose();
      listeners.clear();
      started = false;
    },
  };
};

export { createMessagingSession as default };
