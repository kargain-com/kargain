import { isMessagesAccepting, isMessagesExplicitlyDisabled } from "@/lib/nostr/messages-enabled";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

export type MessagingDrift =
  | "none"
  | "local_ahead"
  | "relay_opt_out"
  | "network_unregistered";

export type MessagingActivationInput = {
  xmtpLocalReady: boolean;
  xmtpNetworkRegistered: boolean;
  nostrProfile: NostrProfileData | null | undefined;
  nostrLoaded: boolean;
  hasLocalOptIn: boolean;
};

export type MessagingActivationSnapshot = {
  xmtpLocalReady: boolean;
  xmtpNetworkRegistered: boolean;
  nostrAccepting: boolean;
  nostrLoaded: boolean;
  switchOn: boolean;
  publiclyReachable: boolean;
  drift: MessagingDrift;
  explicitlyOptedOut: boolean;
};

export function deriveMessagingActivation(
  input: MessagingActivationInput,
): MessagingActivationSnapshot {
  const nostrAccepting = isMessagesAccepting(input.nostrProfile);
  const explicitlyOptedOut = isMessagesExplicitlyDisabled(input.nostrProfile);

  const switchOn =
    input.nostrLoaded &&
    input.xmtpLocalReady &&
    input.xmtpNetworkRegistered &&
    nostrAccepting;

  const publiclyReachable = input.xmtpNetworkRegistered && nostrAccepting;

  let drift: MessagingDrift = "none";
  if (input.xmtpLocalReady && explicitlyOptedOut) {
    drift = "relay_opt_out";
  } else if (input.xmtpLocalReady && input.nostrLoaded && !input.xmtpNetworkRegistered) {
    drift = "network_unregistered";
  } else if (
    input.hasLocalOptIn &&
    input.xmtpLocalReady &&
    input.nostrLoaded &&
    nostrAccepting &&
    !input.xmtpNetworkRegistered
  ) {
    drift = "network_unregistered";
  } else if (input.xmtpLocalReady && input.nostrLoaded && !nostrAccepting) {
    drift = "relay_opt_out";
  } else if (
    input.hasLocalOptIn &&
    !input.xmtpLocalReady &&
    !explicitlyOptedOut &&
    input.nostrLoaded
  ) {
    drift = "local_ahead";
  }

  return {
    xmtpLocalReady: input.xmtpLocalReady,
    xmtpNetworkRegistered: input.xmtpNetworkRegistered,
    nostrAccepting,
    nostrLoaded: input.nostrLoaded,
    switchOn,
    publiclyReachable,
    drift,
    explicitlyOptedOut,
  };
}
