"use client";

/**
 * In-memory SVM wallet session — one connected Solana account at a time.
 * Cleared on EVM connect (mutual exclusion with the EVM adapter).
 *
 * The ActiveAccountSvm value is built once via {@link svmActiveAccountFromAddress}
 * at connect and on an accepted `set_address` change — never during render.
 * Sole address fact: `account.address` (no parallel top-level address field).
 *
 * `disconnect` reads `session` from render scope (`useCallback` deps `[session]`).
 * Session identity changes only on connect / accepted change / clear / disconnect —
 * that dependency does not reintroduce per-render account churn.
 *
 * While a session is live, subscribes once to the wallet's `standard:events`
 * `"change"`. accounts[0] updated → address canonicalised via kit; accounts
 * empty → session cleared. A wallet without `standard:events` is a named
 * limitation (session is a connect-time snapshot only) — never a poll loop.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { address as assertSolanaAddress } from "@solana/kit";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import type { Wallet } from "@wallet-standard/base";

import {
  applySvmSessionChangeDecision,
  decideSvmAccountChangeEvent,
  svmActiveAccountFromAddress,
  type ActiveAccountSvm,
} from "@/lib/web3/active-account";
import {
  findDiscoveredSvmWallet,
  type SvmDiscoveredWallet,
} from "@/lib/web3/svm-wallet-discovery";

export type SvmSessionState = {
  walletName: string;
  wallet: Wallet;
  /** Built once at connect / accepted change — adapter returns this reference. */
  account: ActiveAccountSvm;
} | null;

type SvmAccountSessionValue = {
  session: SvmSessionState;
  connect: (walletName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clear: () => void;
};

const SvmAccountSessionContext = createContext<SvmAccountSessionValue | null>(
  null,
);

function connectFeature(
  wallet: Wallet,
): StandardConnectFeature[typeof StandardConnect] {
  const feature = wallet.features[StandardConnect] as
    | StandardConnectFeature[typeof StandardConnect]
    | undefined;
  if (feature == null || typeof feature.connect !== "function") {
    throw new Error(`Wallet ${wallet.name} does not support standard:connect`);
  }
  return feature;
}

function disconnectFeature(
  wallet: Wallet,
): StandardDisconnectFeature[typeof StandardDisconnect] | undefined {
  const feature = wallet.features[StandardDisconnect] as
    | StandardDisconnectFeature[typeof StandardDisconnect]
    | undefined;
  if (feature == null || typeof feature.disconnect !== "function") {
    return undefined;
  }
  return feature;
}

function eventsFeature(
  wallet: Wallet,
): StandardEventsFeature[typeof StandardEvents] | undefined {
  const feature = wallet.features[StandardEvents] as
    | StandardEventsFeature[typeof StandardEvents]
    | undefined;
  if (feature == null || typeof feature.on !== "function") {
    return undefined;
  }
  return feature;
}

export function SvmAccountSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] = useState<SvmSessionState>(null);

  const clear = useCallback(() => {
    setSession(null);
  }, []);

  const disconnect = useCallback(async () => {
    const current = session;
    setSession(null);
    if (!current) return;
    const feature = disconnectFeature(current.wallet);
    if (feature) {
      try {
        await feature.disconnect();
      } catch {
        /* wallet cleanup is best-effort */
      }
    }
  }, [session]);

  const connect = useCallback(async (walletName: string) => {
    const discovered: SvmDiscoveredWallet | undefined =
      findDiscoveredSvmWallet(walletName);
    if (!discovered) {
      throw new Error(`Solana wallet not found: ${walletName}`);
    }
    const { wallet } = discovered;
    const feature = connectFeature(wallet);
    const { accounts } = await feature.connect();
    const account = accounts[0] ?? wallet.accounts[0];
    if (!account) {
      throw new Error(`Solana wallet ${wallet.name} returned no accounts`);
    }
    const canonical = assertSolanaAddress(account.address);
    setSession({
      walletName: wallet.name,
      wallet,
      account: svmActiveAccountFromAddress(canonical),
    });
  }, []);

  // Wallet Standard account change while session is live.
  // Named limitation: wallets without standard:events keep a connect-time
  // snapshot only — no polling substitute.
  useEffect(() => {
    if (!session) return;
    const feature = eventsFeature(session.wallet);
    if (!feature) return;
    return feature.on("change", (properties) => {
      if (properties.accounts === undefined) return;
      const accounts = properties.accounts;
      setSession((prev) => {
        if (!prev) return null;
        const decision = decideSvmAccountChangeEvent({
          currentAddress: prev.account.address,
          accounts,
        });
        return applySvmSessionChangeDecision(prev, decision);
      });
    });
  }, [session]);

  const value = useMemo(
    () => ({ session, connect, disconnect, clear }),
    [session, connect, disconnect, clear],
  );

  return (
    <SvmAccountSessionContext.Provider value={value}>
      {children}
    </SvmAccountSessionContext.Provider>
  );
}

export function useSvmAccountSession(): SvmAccountSessionValue {
  const ctx = useContext(SvmAccountSessionContext);
  if (!ctx) {
    throw new Error(
      "useSvmAccountSession must be used within SvmAccountSessionProvider",
    );
  }
  return ctx;
}
