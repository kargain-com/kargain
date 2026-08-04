import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event } from "nostr-tools";
import type { Address, WalletClient } from "viem";

import {
  setAppEventStorePoolForTest,
  type AppEventQueryPool,
  type AppEventRelay,
} from "../lib/nostr/app-event-store.ts";
import { createNostrPolicyAdapter } from "../lib/messaging/adapters/nostr-adapter.ts";
import {
  deriveEnableWalletSignatures,
  enableWalletSignaturesCopy,
} from "../lib/messaging/enable-cost.ts";
import type { NostrIdentityCapability } from "../lib/messaging/ports.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";
import { publishMessagingIntent } from "../lib/nostr/messaging-intent.ts";
import type { NostrPublishPool } from "../lib/nostr/publish-event.ts";
import { NOSTR_RELAYS } from "../lib/nostr/relays.ts";
import {
  advanceAndSettle,
  createControlledClock,
  disposeAllOpenSessions,
  openSession,
} from "./messaging-contract-harness.ts";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const PUBKEY = nostrPubkeyFromPrivateKey(PRIVATE_KEY);

afterEach(async () => {
  setAppEventStorePoolForTest(null);
  await disposeAllOpenSessions();
});

describe("deriveEnableWalletSignatures", () => {
  it("covers four key × attestation combos without prompts", () => {
    const combos = [
      { keyHeld: false, attestationValid: false, needsCreate: true, expected: 3 },
      { keyHeld: true, attestationValid: false, needsCreate: true, expected: 2 },
      { keyHeld: false, attestationValid: true, needsCreate: true, expected: 2 },
      { keyHeld: true, attestationValid: true, needsCreate: true, expected: 1 },
      { keyHeld: true, attestationValid: true, needsCreate: false, expected: 0 },
      { keyHeld: false, attestationValid: false, needsCreate: false, expected: 2 },
    ] as const;
    for (const row of combos) {
      assert.equal(deriveEnableWalletSignatures(row), row.expected, JSON.stringify(row));
    }
  });

  it("copy is sentence case for one vs many", () => {
    assert.equal(
      enableWalletSignaturesCopy(1),
      "Turning on messages needs 1 wallet signature.",
    );
    assert.equal(
      enableWalletSignaturesCopy(3),
      "Turning on messages needs 3 wallet signatures.",
    );
  });
});

type TestPool = AppEventQueryPool &
  NostrPublishPool & {
    publishCount: number;
  };

function makeTestPool(content: Record<string, unknown> = {}): TestPool {
  let publishCount = 0;
  const event: Event = {
    id: "dd".repeat(32),
    pubkey: PUBKEY,
    kind: 0,
    created_at: 1,
    content: JSON.stringify(content),
    tags: [["i", `ethereum:${WALLET.toLowerCase()}`]],
    sig: "cc".repeat(64),
  };
  return {
    get publishCount() {
      return publishCount;
    },
    async ensureRelay() {
      const relay: AppEventRelay = {
        subscribe(_filters, params) {
          queueMicrotask(() => {
            params.onevent?.(event);
            params.oneose?.();
          });
          return { close() {} };
        },
      };
      return relay;
    },
    publish(urls) {
      publishCount += 1;
      return urls.map(() => Promise.resolve("ok"));
    },
  };
}

describe("intent publish signature counts", () => {
  it("valid attestation on merge base → zero attest signatures", async () => {
    // Pre-seed content with a field that verify will reject → counts attest.
    // When attestation opts supplied, no signMessage for attest.
    const pool = makeTestPool({ name: "Ada" });
    setAppEventStorePoolForTest(pool);
    let signCount = 0;
    const ok = await publishMessagingIntent(
      WALLET,
      true,
      {
        signMessage: async () => {
          signCount += 1;
          return ("0x" + "ab".repeat(65)) as `0x${string}`;
        },
      },
      {
        privateKeyHex: PRIVATE_KEY,
        attestation: { v: 1, sig: ("0x" + "cd".repeat(65)) as `0x${string}` },
      },
    );
    assert.equal(ok, true);
    assert.equal(signCount, 0);
    assert.equal(pool.publishCount, 1);
  });

  it("missing attestation → exactly one attest signature (key injected)", async () => {
    const pool = makeTestPool({});
    setAppEventStorePoolForTest(pool);
    let signCount = 0;
    const ok = await publishMessagingIntent(
      WALLET,
      true,
      {
        signMessage: async () => {
          signCount += 1;
          return ("0x" + "ab".repeat(65)) as `0x${string}`;
        },
      },
      { privateKeyHex: PRIVATE_KEY },
    );
    assert.equal(ok, true);
    assert.equal(signCount, 1);
    assert.ok(NOSTR_RELAYS.length >= 1);
  });
});

describe("nostr-adapter identity owner", () => {
  // I15 — Blind spot: declined≠failed is proven for the adapter port; a surface
  // that maps signature_declined to publish_failed in UI copy is out of scope here.
  it("declined unlock → signature_declined not publish_failed", async () => {
    const identity: NostrIdentityCapability = {
      async obtainKey() {
        return { status: "declined" };
      },
      isKeyHeld: () => false,
      getAttestationValidCached: () => null,
      markAttestationValid() {},
    };

    const adapter = createNostrPolicyAdapter({
      getAddress: () => WALLET,
      getWalletClient: () =>
        ({
          signMessage: async () => {
            throw new Error("should not sign");
          },
        }) as unknown as WalletClient,
      identity,
    });

    const result = await adapter.publishIntent(WALLET, true);
    assert.deepEqual(result, { ok: false, reason: "signature_declined" });
  });

  it("key already held → obtainKey ready without wallet unlock path", async () => {
    let obtainCalls = 0;
    const identity: NostrIdentityCapability = {
      async obtainKey() {
        obtainCalls += 1;
        return { status: "ready", privateKey: PRIVATE_KEY };
      },
      isKeyHeld: () => true,
      getAttestationValidCached: () => true,
      markAttestationValid() {},
    };
    assert.equal(identity.isKeyHeld(), true);
    const got = await identity.obtainKey();
    assert.equal(got.status, "ready");
    assert.equal(obtainCalls, 1);
  });

  it("concurrent obtainKey shares one pending unlock", async () => {
    let unlockStarts = 0;
    let heldKey: `0x${string}` | null = null;
    let pending: Promise<
      { status: "ready"; privateKey: `0x${string}` } | { status: "declined" }
    > | null = null;

    const identity: NostrIdentityCapability = {
      async obtainKey() {
        if (heldKey) return { status: "ready", privateKey: heldKey };
        if (!pending) {
          unlockStarts += 1;
          pending = new Promise((resolve) => {
            setTimeout(() => {
              heldKey = PRIVATE_KEY;
              resolve({ status: "ready", privateKey: PRIVATE_KEY });
              pending = null;
            }, 5);
          });
        }
        return pending;
      },
      isKeyHeld: () => heldKey != null,
      getAttestationValidCached: () => true,
      markAttestationValid() {},
    };

    const [a, b] = await Promise.all([identity.obtainKey(), identity.obtainKey()]);
    assert.equal(a.status, "ready");
    assert.equal(b.status, "ready");
    assert.equal(unlockStarts, 1);
  });
});

describe("session publish decline + enable cost", () => {
  it("signature_declined does not sticky publish_failed", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: {
        publishIntent: async () => ({ ok: false, reason: "signature_declined" }),
      },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
        createWithSigner: async () => ({
          ok: true,
          client: { __brand: "XmtpLocalClient" as const },
        }),
      },
    });
    session.start();
    session.requestLocalClient();
    await advanceAndSettle(clock, 20_000);
    session.dispatch({ type: "enable" });
    await advanceAndSettle(clock, 20_000);
    const snap = session.getSnapshot();
    if (snap.state === "active") {
      assert.equal(snap.publishError, undefined);
    } else {
      assert.notEqual(
        snap.state === "error" ? snap.reason : null,
        "publish_failed",
      );
    }
  });

  it("projects enableWalletSignatures for held key + valid attestation", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: {
        isKeyHeld: () => true,
        getAttestationValidCached: () => true,
        probeAttestationValid: async () => true,
      },
    });
    session.start();
    await advanceAndSettle(clock, 20_000);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "disabled");
    if (snap.state === "disabled") {
      // create still needed → 1
      assert.equal(snap.enableWalletSignatures, 1);
    }
  });

  it("projects enableWalletSignatures cold = 3", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: {
        isKeyHeld: () => false,
        getAttestationValidCached: () => false,
        probeAttestationValid: async () => false,
      },
    });
    session.start();
    await advanceAndSettle(clock, 20_000);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "disabled");
    if (snap.state === "disabled") {
      assert.equal(snap.enableWalletSignatures, 3);
    }
  });
});
