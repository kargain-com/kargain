import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GLOBAL_PROVIDER_IDS,
  IDENTITY_PROVIDER_IDS,
  PROVIDER_SCOPE,
} from "@/lib/providers/provider-scope";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("provider scope policy", () => {
  it("pins global vs identity provider ids from the registry", () => {
    assert.deepEqual(
      [...GLOBAL_PROVIDER_IDS].sort(),
      [
        "DisplayCurrencyProvider",
        "QueryClientProvider",
        "WagmiProvider",
        "WalletSessionSync",
      ].sort(),
    );
    assert.deepEqual(
      [...IDENTITY_PROVIDER_IDS].sort(),
      [
        "MessagingSessionProvider",
        "NostrKeyProvider",
        "NotificationsProvider",
        "XmtpConversationsProvider",
      ].sort(),
    );
    assert.equal(PROVIDER_SCOPE.length, 8);
  });

  it("keeps root AppProviders free of identity providers", () => {
    const text = read("components/providers/app-providers.tsx");
    assert.doesNotMatch(text, /NostrKeyProvider/);
    assert.doesNotMatch(text, /MessagingNotificationsProviders/);
    assert.doesNotMatch(text, /MessagingSessionProvider/);
    assert.doesNotMatch(text, /NotificationsProvider/);
    assert.doesNotMatch(text, /XmtpConversationsProvider/);
    assert.match(text, /QueryClientProvider/);
    assert.match(text, /WagmiProvider/);
    assert.match(text, /DisplayCurrencyProvider/);
    assert.match(text, /WalletSessionSync/);
  });

  it("mounts identity providers only in identity layout via IdentityProviders", () => {
    const identityLayout = read("app/(identity)/layout.tsx");
    assert.match(identityLayout, /IdentityProviders/);
    assert.match(identityLayout, /identityBadges/);

    const identityProviders = read("components/providers/identity-providers.tsx");
    assert.match(identityProviders, /NostrKeyProvider/);
    assert.match(identityProviders, /MessagingNotificationsProviders/);

    const publicLayout = read("app/(public)/layout.tsx");
    assert.doesNotMatch(publicLayout, /IdentityProviders|NostrKey|Messaging/);
    assert.match(publicLayout, /identityBadges=\{false\}/);
  });

  it("keeps root layout free of SiteChrome and identity providers", () => {
    const root = read("app/layout.tsx");
    assert.doesNotMatch(root, /SiteChrome/);
    assert.doesNotMatch(root, /NostrKey|MessagingNotifications|IdentityProviders/);
    assert.match(root, /AppProviders/);
  });

  it("fail-closes useMessagingSession outside provider", () => {
    const hook = read("hooks/use-messaging-session.ts");
    assert.match(hook, /must be used within MessagingSessionProvider/);
    const provider = read("components/providers/messaging-session-provider.tsx");
    assert.match(
      provider,
      /createContext<MessagingSessionContextValue\s*\|\s*null>\(null\)/,
    );
  });

  it("defers WalletConnect out of createWagmiConfig boot path", () => {
    const config = read("lib/web3/wagmi-config.ts");
    assert.match(config, /ensureWalletConnectConnector/);
    assert.match(config, /from "wagmi\/connectors"/);
    // walletConnect must not appear in createWagmiConfig body as a sync call
    const createFn = config.slice(
      config.indexOf("export function createWagmiConfig"),
      config.indexOf("export type WagmiConfig"),
    );
    assert.doesNotMatch(createFn, /walletConnect\s*\(/);
    assert.match(createFn, /buildInjectedConnector\s*\(\)/);
    assert.match(config, /injected\s*\(/);

    const login = read("components/wallet-login-button.tsx");
    assert.match(login, /ensureWalletConnectConnector/);
  });

  it("SiteChrome is a server shell with optional identity badges", () => {
    const chrome = read("components/shell/site-chrome.tsx");
    assert.doesNotMatch(chrome, /^["']use client["']/m);
    assert.match(chrome, /SiteFooter/);
    assert.match(chrome, /identityBadges/);
  });

  it("nav must not statically import identity badge modules", () => {
    for (const rel of [
      "components/shell/app-top-nav.tsx",
      "components/shell/mobile-bottom-nav.tsx",
    ]) {
      const text = read(rel);
      assert.doesNotMatch(
        text,
        /from\s+["']@\/components\/messaging\/messaging-nav-status["']/,
      );
      assert.doesNotMatch(
        text,
        /from\s+["']@\/components\/notifications\/notifications-unread-badge["']/,
      );
      assert.match(text, /next\/dynamic/);
    }
  });
});
