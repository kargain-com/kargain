import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

/** User explicitly opted out on Nostr kind:0. */
export function isMessagesExplicitlyDisabled(
  profile: NostrProfileData | null | undefined,
): boolean {
  return profile?.messagesEnabled === false;
}

/** Default accepting when field is absent (platform policy: opt-out only). */
export function isMessagesAccepting(profile: NostrProfileData | null | undefined): boolean {
  return !isMessagesExplicitlyDisabled(profile);
}
