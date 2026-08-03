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
  isMessagingStorageAvailable,
} from "./adapters/cache-adapter";
import { getMessagingXmtpEnv } from "./xmtp-env";
import { createEffectsRunner, getSessionSnapshot } from "./effects";
import { unbrandClient } from "./adapters/xmtp-adapter";

export const createMessagingSession: CreateMessagingSession = (
  input: CreateMessagingSessionInput,
): MessagingSession => {
  const cache =
    input.cache ??
    (isMessagingStorageAvailable()
      ? createMessagingCachePort(getMessagingXmtpEnv())
      : createInMemoryMessagingCache());
  const listeners = new Set<() => void>();
  let started = false;

  let cachedSnapshot: SessionSnapshot;

  const runner = createEffectsRunner({
    address: input.address,
    ports: input.ports,
    clock: input.clock,
    cache,
    onChange: () => {
      refreshCachedSnapshot();
      for (const listener of listeners) listener();
    },
  });

  function snapshotNow(): SessionSnapshot {
    return getSessionSnapshot(runner.getState(), input.ports, input.clock.nowMs());
  }

  function refreshCachedSnapshot(): void {
    const next = snapshotNow();
    if (
      cachedSnapshot &&
      JSON.stringify(cachedSnapshot) === JSON.stringify(next)
    ) {
      return;
    }
    cachedSnapshot = next;
  }

  refreshCachedSnapshot();

  return {
    getSnapshot() {
      // Recompute so live identity facts (key held / attestation cache) apply
      // without a machine event; return prior ref when unchanged (uSES stability).
      const next = snapshotNow();
      if (JSON.stringify(cachedSnapshot) === JSON.stringify(next)) {
        return cachedSnapshot;
      }
      cachedSnapshot = next;
      return cachedSnapshot;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    dispatch(command: SessionCommand) {
      if (cachedSnapshot.state === "disconnected" || cachedSnapshot.state === "unsupported") {
        return;
      }
      runner.dispatch(command);
    },
    getXmtpClient() {
      const client = runner.getState().localClient;
      return client ? unbrandClient(client) : null;
    },
    async readInstallations() {
      const machine = runner.getState();
      return input.ports.xmtp.readInstallations(
        machine.address,
        undefined,
        machine.localClient,
      );
    },
    isRevokeAllOnCooldown() {
      return runner.getState().revokeAllCooldown;
    },
    start() {
      if (started) return;
      started = true;
      runner.start();
    },
    requestLocalClient() {
      runner.requestLocalClient();
    },
    releaseLocalClient() {
      runner.releaseLocalClient();
    },
    changeAddress(address: string) {
      runner.onAddressChange(address);
    },
    dispose() {
      runner.dispose();
      listeners.clear();
      started = false;
    },
  };
};

export { createMessagingSession as default };
