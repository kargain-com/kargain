import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { loadFavorites, saveFavorites } from "@/lib/nostr/favorites";
import {
  loadNotificationState,
  mergeNotificationStates,
  saveNotificationState,
  type NotificationState,
} from "@/lib/nostr/notification-state";
import { nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import { saveCachedPubkey } from "@/lib/nostr/nostr-pubkey-cache";
import { publishNostrProfileWithPrivateKey } from "@/lib/nostr/profile";
import {
  attestationMessage,
  buildProfileAttestation,
  type ProfileAttestationV1,
} from "@/lib/nostr/profile-attestation";
import { resolveAttestedProfile } from "@/lib/nostr/resolve-attested-profile";

export type MigrateNostrIdentityResult =
  | { ok: true }
  | { ok: false; error: string };

export type MigrateNostrIdentityDeps = {
  loadFavorites: (pubkey: string) => Promise<string[]>;
  saveFavorites: (tokenIds: string[], privateKey: string) => Promise<void>;
  loadNotificationState: (
    address: `0x${string}`,
    pubkey: string,
  ) => Promise<NotificationState>;
  saveNotificationState: (
    address: `0x${string}`,
    state: NotificationState,
    privateKey: string,
  ) => Promise<void>;
  fetchProfile: (
    address: `0x${string}`,
  ) => Promise<NostrProfileData | null>;
  publishProfile: (
    data: NostrProfileData,
    walletAddress: `0x${string}`,
    privateKeyHex: string,
    attestation?: ProfileAttestationV1,
  ) => Promise<boolean>;
  savePubkeyCache: (address: `0x${string}`, pubkey: string) => void;
};

export type MigrateNostrIdentityInput = {
  address: `0x${string}`;
  oldPubkey: string;
  newPrivateKey: `0x${string}`;
  signMessage: (msg: string) => Promise<`0x${string}`>;
  deps?: Partial<MigrateNostrIdentityDeps>;
};

function normalizePubkeyHex(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

/** Union-merge favorite token IDs; old list first, then new-only entries. */
export function unionFavoriteTokenIds(oldIds: string[], newIds: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...oldIds, ...newIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

/** True when old and new pubkeys are the same (migration already complete). */
export function shouldSkipMigrationStep(oldPubkey: string, newPubkey: string): boolean {
  return normalizePubkeyHex(oldPubkey) === normalizePubkeyHex(newPubkey);
}

const defaultDeps: MigrateNostrIdentityDeps = {
  loadFavorites,
  saveFavorites,
  loadNotificationState,
  saveNotificationState,
  fetchProfile: resolveAttestedProfile,
  publishProfile: publishNostrProfileWithPrivateKey,
  savePubkeyCache: saveCachedPubkey,
};

/**
 * Copy attested profile, watchlist, and notification state from oldPubkey to newPrivateKey.
 * Idempotent — safe to re-run.
 */
export async function migrateNostrIdentity(
  input: MigrateNostrIdentityInput,
): Promise<MigrateNostrIdentityResult> {
  const deps = { ...defaultDeps, ...input.deps };
  const { address, oldPubkey, newPrivateKey, signMessage } = input;

  try {
    const newPubkey = nostrPubkeyFromPrivateKey(newPrivateKey);

    if (shouldSkipMigrationStep(oldPubkey, newPubkey)) {
      deps.savePubkeyCache(address, newPubkey);
      return { ok: true };
    }

    const [oldFavs, newFavs] = await Promise.all([
      deps.loadFavorites(oldPubkey),
      deps.loadFavorites(newPubkey),
    ]);
    const mergedFavs = unionFavoriteTokenIds(oldFavs, newFavs);
    await deps.saveFavorites(mergedFavs, newPrivateKey);

    const [oldState, newState] = await Promise.all([
      deps.loadNotificationState(address, oldPubkey),
      deps.loadNotificationState(address, newPubkey),
    ]);
    const mergedState = mergeNotificationStates(oldState, newState);
    await deps.saveNotificationState(address, mergedState, newPrivateKey);

    const profile = (await deps.fetchProfile(address)) ?? {};
    const attestationSig = await signMessage(attestationMessage(newPubkey, address));
    const attestation = buildProfileAttestation({
      pubkey: newPubkey,
      address,
      signature: attestationSig,
    });
    const published = await deps.publishProfile(
      profile,
      address,
      newPrivateKey,
      attestation,
    );
    if (!published) {
      return { ok: false, error: "Profile publish failed" };
    }

    deps.savePubkeyCache(address, newPubkey);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Migration failed" };
  }
}
