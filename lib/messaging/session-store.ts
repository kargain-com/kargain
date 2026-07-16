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

  runner.start();

  let snapshot: SessionSnapshot = getSessionSnapshot(
    runner.getState(),
    input.ports,
    input.clock.nowMs(),
  );

  function refreshSnapshot() {
    const walletAddress = input.ports.wallet.getAddress();
    const sessionAddress = runner.getState().address;
    if (walletAddress && walletAddress.toLowerCase() !== sessionAddress.toLowerCase()) {
      runner.onAddressChange(walletAddress);
    }
    snapshot = getSessionSnapshot(runner.getState(), input.ports, input.clock.nowMs());
  }

  return {
    getSnapshot() {
      refreshSnapshot();
      return snapshot;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    dispatch(command: SessionCommand) {
      const current = getSessionSnapshot(
        runner.getState(),
        input.ports,
        input.clock.nowMs(),
      );
      if (current.state === "disconnected" || current.state === "unsupported") {
        return;
      }
      refreshSnapshot();
      runner.dispatch(command);
      refreshSnapshot();
    },
    getXmtpClient() {
      refreshSnapshot();
      const client = runner.getState().localClient;
      return client ? unbrandClient(client) : null;
    },
    dispose() {
      runner.dispose();
      listeners.clear();
    },
  };
};

export { createMessagingSession as default };
