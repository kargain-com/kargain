/**
 * Provider mount scopes — derived from hook consumers, not assumptions.
 * Global = justified on every route (incl. public home). Identity = only
 * routes under `app/(identity)/` where messaging/Nostr/notifications run.
 */

export type ProviderScope = "global" | "identity";

export type ProviderScopeEntry = {
  id: string;
  scope: ProviderScope;
  /** Consumer that forces this scope. */
  justifyingConsumer: string;
};

export const PROVIDER_SCOPE: readonly ProviderScopeEntry[] = [
  {
    id: "QueryClientProvider",
    scope: "global",
    justifyingConsumer: "React Query across app (browse, wallet, forms)",
  },
  {
    id: "WagmiProvider",
    scope: "global",
    justifyingConsumer:
      "EVM account adapter under useActiveAccount (AppTopNav, WalletLoginButton, writes)",
  },
  {
    id: "SvmAccountSessionProvider",
    scope: "global",
    justifyingConsumer:
      "SVM Wallet Standard session under useActiveAccount / WalletLoginButton",
  },
  {
    id: "DisplayCurrencyProvider",
    scope: "global",
    justifyingConsumer:
      "CurrencySelector every page; market-browse / ListingDisplayPrice",
  },
  {
    id: "WalletSessionSync",
    scope: "global",
    justifyingConsumer: "SIWE clear on EVM address/chain change via useActiveAccount",
  },
  {
    id: "NostrKeyProvider",
    scope: "identity",
    justifyingConsumer:
      "MessagingSessionProvider, notifications, watchlist, comments, offers, commons",
  },
  {
    id: "NotificationsProvider",
    scope: "identity",
    justifyingConsumer: "Alerts UI + NotificationsUnreadBadge on identity chrome",
  },
  {
    id: "MessagingSessionProvider",
    scope: "identity",
    justifyingConsumer:
      "Messages, setup, seller/verifier contact, MessagingNavStatus on identity chrome",
  },
  {
    id: "XmtpConversationsProvider",
    scope: "identity",
    justifyingConsumer: "Inbox / unread under MessagingSessionProvider",
  },
] as const;

export const GLOBAL_PROVIDER_IDS = PROVIDER_SCOPE.filter((e) => e.scope === "global").map(
  (e) => e.id,
);

export const IDENTITY_PROVIDER_IDS = PROVIDER_SCOPE.filter(
  (e) => e.scope === "identity",
).map((e) => e.id);

/** Public routes: no identity providers; chrome badges off. */
export const PUBLIC_ROUTE_SEGMENTS = ["", "about", "terms", "privacy"] as const;
