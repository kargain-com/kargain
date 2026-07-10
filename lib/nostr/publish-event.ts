import type { Event } from "nostr-tools";

import { KARGAIN_RELAY, NOSTR_RELAYS } from "@/lib/nostr/relays";

export type PublishSignedEventResult = {
  ok: boolean;
  ownRelayAck: Promise<boolean>;
};

export type NostrPublishPool = {
  publish: (urls: string[], event: Event) => Promise<string>[];
};

export type PublishSignedEventOptions = {
  ownRelayTimeoutMs?: number;
};

const OWN_RELAY_TIMEOUT_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, sleep(ms).then(() => fallback)]);
}

function trackOwnRelayAck(
  perRelay: Promise<string>[],
  ownIndex: number,
  timeoutMs: number,
): Promise<boolean> {
  if (ownIndex < 0) return Promise.resolve(false);
  return raceWithTimeout(
    perRelay[ownIndex].then(() => true).catch(() => false),
    timeoutMs,
    false,
  ).catch(() => false);
}

/** Publish to all relays; fail-open on first ack. Never throws. */
export async function publishSignedEvent(
  pool: NostrPublishPool,
  signedEvent: Event,
  options?: PublishSignedEventOptions,
): Promise<PublishSignedEventResult> {
  try {
    const relays = [...NOSTR_RELAYS];
    const perRelay = pool.publish(relays, signedEvent);
    const ownIndex = relays.indexOf(KARGAIN_RELAY);
    const ownRelayTimeoutMs = options?.ownRelayTimeoutMs ?? OWN_RELAY_TIMEOUT_MS;
    const ownRelayAck = trackOwnRelayAck(perRelay, ownIndex, ownRelayTimeoutMs);

    const indexed = perRelay.map((promise, index) =>
      promise.then((id) => ({ index, id })),
    );

    let ok = false;
    try {
      await Promise.any(indexed);
      ok = true;
    } catch {
      ok = false;
    }

    return { ok, ownRelayAck };
  } catch {
    return { ok: false, ownRelayAck: Promise.resolve(false) };
  }
}
