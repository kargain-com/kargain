import type { Event } from "nostr-tools";
import { type Address, getAddress, recoverMessageAddress } from "viem";

export type ProfileAttestationV1 = {
  v: 1;
  sig: `0x${string}`;
};

export type ProfileAttestationEvent = Pick<Event, "id" | "pubkey" | "content">;

const MEMO_MAX = 512;
const verificationMemo = new Map<string, boolean>();

function normalizePubkeyHex(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

function normalizeWalletAddress(address: Address | `0x${string}`): `0x${string}` {
  return getAddress(address) as `0x${string}`;
}

export function attestationMessage(
  nostrPubkeyHex: string,
  address: Address | `0x${string}`,
): string {
  const pubkey = normalizePubkeyHex(nostrPubkeyHex);
  const wallet = normalizeWalletAddress(address).toLowerCase();
  return `Kargain profile binding v1\nnostr:${pubkey}\nethereum:${wallet}`;
}

export function parseProfileAttestationField(
  value: unknown,
): ProfileAttestationV1 | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (obj.v !== 1) return undefined;
  if (typeof obj.sig !== "string") return undefined;
  const sig = obj.sig.trim();
  if (!sig.startsWith("0x") || sig.length <= 2) return undefined;
  return { v: 1, sig: sig as `0x${string}` };
}

export function readProfileAttestationFromContent(
  content: string,
): ProfileAttestationV1 | undefined {
  if (!content.trim()) return undefined;
  try {
    const raw: unknown = JSON.parse(content);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    return parseProfileAttestationField(
      (raw as Record<string, unknown>).attestation,
    );
  } catch {
    return undefined;
  }
}

export function buildProfileAttestation(input: {
  pubkey: string;
  address: Address | `0x${string}`;
  signature: `0x${string}`;
}): ProfileAttestationV1 {
  void input.pubkey;
  void input.address;
  return { v: 1, sig: input.signature };
}

function addressesEqual(a: Address | `0x${string}`, b: Address | `0x${string}`): boolean {
  return getAddress(a).toLowerCase() === getAddress(b).toLowerCase();
}

export async function verifyProfileAttestationCore(
  event: ProfileAttestationEvent,
  expectedAddress: Address | `0x${string}`,
): Promise<boolean> {
  try {
    const attestation = readProfileAttestationFromContent(event.content);
    if (!attestation) return false;

    const message = attestationMessage(event.pubkey, expectedAddress);
    const recovered = await recoverMessageAddress({
      message,
      signature: attestation.sig,
    });
    return addressesEqual(recovered, expectedAddress);
  } catch {
    return false;
  }
}

function memoSet(eventId: string, value: boolean): void {
  if (verificationMemo.size >= MEMO_MAX) {
    const oldest = verificationMemo.keys().next().value;
    if (oldest != null) verificationMemo.delete(oldest);
  }
  verificationMemo.set(eventId, value);
}

/** Memoized by event id — use verifyProfileAttestationCore on write-path checks. */
export async function verifyProfileAttestation(
  event: ProfileAttestationEvent,
  expectedAddress: Address | `0x${string}`,
): Promise<boolean> {
  const cached = verificationMemo.get(event.id);
  if (cached != null) return cached;

  const result = await verifyProfileAttestationCore(event, expectedAddress);
  memoSet(event.id, result);
  return result;
}

/** Test-only: clear verification memo between cases. */
export function clearProfileAttestationMemoForTests(): void {
  verificationMemo.clear();
}
