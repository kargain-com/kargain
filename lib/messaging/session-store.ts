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

export const createMessagingSession: CreateMessagingSession = (
  input: CreateMessagingSessionInput,
): MessagingSession => {
  const cache =
    typeof localStorage === "undefined"
      ? createInMemoryMessagingCache()
      : createMessagingCachePort(getMessagingXmtpEnv());
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

  let snapshot: SessionSnapshot = getSessionSnapshot(runner.getState(), input.ports);

  function refreshSnapshot() {
    const walletAddress = input.ports.wallet.getAddress();
    const sessionAddress = runner.getState().address;
    if (walletAddress && walletAddress.toLowerCase() !== sessionAddress.toLowerCase()) {
      runner.onAddressChange(walletAddress);
    }
    snapshot = getSessionSnapshot(runner.getState(), input.ports);
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
      const current = getSessionSnapshot(runner.getState(), input.ports);
      if (current.state === "disconnected" || current.state === "unsupported") {
        return;
      }
      refreshSnapshot();
      runner.dispatch(command);
      refreshSnapshot();
    },
  };
};

export { createMessagingSession as default };
