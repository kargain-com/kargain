import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  attestationMessage,
  buildProfileAttestation,
  clearProfileAttestationMemoForTests,
  verifyProfileAttestation,
  type ProfileAttestationEvent,
} from "../lib/nostr/profile-attestation.ts";

const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const ADDRESS = account.address;
const PUBKEY = "aa".repeat(32);

async function signedEvent(
  overrides: Partial<ProfileAttestationEvent> = {},
): Promise<ProfileAttestationEvent> {
  const pubkey = overrides.pubkey ?? PUBKEY;
  const message = attestationMessage(pubkey, ADDRESS);
  const signature = await account.signMessage({ message });
  const attestation = buildProfileAttestation({
    pubkey,
    address: ADDRESS,
    signature,
  });
  const content = JSON.stringify({ name: "Ada", attestation });
  return {
    id: overrides.id ?? "event-1",
    pubkey,
    content: overrides.content ?? content,
  };
}

describe("attestationMessage", () => {
  it("is deterministic for normalized inputs", () => {
    const a = attestationMessage(PUBKEY.toUpperCase(), ADDRESS);
    const b = attestationMessage(PUBKEY, ADDRESS);
    assert.equal(a, b);
    assert.equal(
      a,
      `Kargain profile binding v1\nnostr:${PUBKEY}\nethereum:${ADDRESS.toLowerCase()}`,
    );
  });
});

describe("verifyProfileAttestation", () => {
  it("accepts a valid attestation", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent();
    assert.equal(await verifyProfileAttestation(event, ADDRESS), true);
  });

  it("rejects wrong expected address", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent();
    assert.equal(
      await verifyProfileAttestation(
        event,
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      ),
      false,
    );
  });

  it("rejects wrong pubkey in message", async () => {
    clearProfileAttestationMemoForTests();
    const valid = await signedEvent();
    const parsed = JSON.parse(valid.content) as {
      attestation: { v: 1; sig: string };
    };
    const event: ProfileAttestationEvent = {
      id: "wrong-pubkey",
      pubkey: "bb".repeat(32),
      content: JSON.stringify({
        name: "Ada",
        attestation: parsed.attestation,
      }),
    };
    assert.equal(await verifyProfileAttestation(event, ADDRESS), false);
  });

  it("rejects tampered signature", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent();
    const parsed = JSON.parse(event.content) as {
      attestation: { v: 1; sig: string };
    };
    parsed.attestation.sig = `${parsed.attestation.sig.slice(0, -1)}0`;
    event.content = JSON.stringify(parsed);
    assert.equal(await verifyProfileAttestation(event, ADDRESS), false);
  });

  it("rejects missing attestation field", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent({ content: JSON.stringify({ name: "Ada" }) });
    assert.equal(await verifyProfileAttestation(event, ADDRESS), false);
  });

  it("rejects malformed content", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent({ content: "not-json" });
    assert.equal(await verifyProfileAttestation(event, ADDRESS), false);
  });

  it("rejects bad attestation version", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent({
      content: JSON.stringify({
        attestation: { v: 2, sig: "0x1234" },
      }),
    });
    assert.equal(await verifyProfileAttestation(event, ADDRESS), false);
  });

  it("rejects non-hex signature", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent({
      content: JSON.stringify({
        attestation: { v: 1, sig: "not-a-sig" },
      }),
    });
    assert.equal(await verifyProfileAttestation(event, ADDRESS), false);
  });

  it("memoizes results by event id", async () => {
    clearProfileAttestationMemoForTests();
    const event = await signedEvent({ id: "memo-event" });

    assert.equal(await verifyProfileAttestation(event, ADDRESS), true);

    const tampered = { ...event, content: JSON.stringify({ name: "Tampered" }) };
    assert.equal(await verifyProfileAttestation(tampered, ADDRESS), true);

    clearProfileAttestationMemoForTests();
    assert.equal(await verifyProfileAttestation(tampered, ADDRESS), false);
  });
});

describe("buildProfileAttestation", () => {
  it("stores only version and signature", async () => {
    const signature = await account.signMessage({
      message: attestationMessage(PUBKEY, ADDRESS),
    });
    const built = buildProfileAttestation({
      pubkey: PUBKEY,
      address: ADDRESS,
      signature,
    });
    assert.deepEqual(built, { v: 1, sig: signature });
    assert.equal("pubkey" in built, false);
    assert.equal("address" in built, false);
  });
});
