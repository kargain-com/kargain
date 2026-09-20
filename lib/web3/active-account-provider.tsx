"use client";

/**
 * Sole ActiveAccount computation for the product tree (S8-D session store).
 * Calls {@link useEvmAccountAdapter} and {@link useSvmAccountAdapter} exactly
 * once; owns Wallet Standard discovery subscription; derives observed-family
 * mutual exclusion via {@link decideObservedFamilyConflict}.
 *
 * Context value identity: account references come from adapters (SVM stored at
 * connect/change; EVM memoised). Callbacks depend only on adapters' own stable
 * callbacks — never on whole snapshot objects.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Connector } from "wagmi";
import type { Wallet } from "@wallet-standard/base";

import {
  DISCONNECTED_ACCOUNT,
  connectedAddress,
  decideObservedFamilyConflict,
  dispatchConnect,
  isAccountConnected,
  requireEvmSigningBinding,
  type AccountSigningBinding,
  type ActiveAccount,
  type ConnectOption,
  type ConnectTarget,
} from "@/lib/web3/active-account";
import { useEvmAccountAdapter } from "@/lib/web3/evm-account-adapter";
import { useSvmAccountAdapter } from "@/lib/web3/svm-account-adapter";
import {
  listDiscoveredSvmWallets,
  subscribeSvmWalletDiscovery,
  type SvmDiscoveredWallet,
} from "@/lib/web3/svm-wallet-discovery";

function evmConnectorLabel(connector: Connector): string {
  if (connector.id === "injected") return "Browser wallet";
  return connector.name;
}

export type UseActiveAccountResult = {
  account: ActiveAccount;
  /** Any-family display address. */
  address: string | undefined;
  isConnected: boolean;
  disconnect: () => Promise<void>;
  connect: (target: ConnectTarget) => Promise<void>;
  /**
   * Switch the EVM wallet chain. Call sites must gate with
   * {@link evmSwitchChainAvailability} first — never treat absence as silence.
   */
  switchChain: (chainId: number) => Promise<void>;
  /** Discriminated EVM + SVM connect rows for the connect dialog. */
  connectOptions: readonly ConnectOption[];
  /**
   * Personal-sign / wallet-client binding — always a Result (never undefined connector).
   */
  signingBinding: AccountSigningBinding;
  /**
   * Wallet Standard wallet while an SVM session is live — Irys Solana payment door.
   * Null when disconnected or on an EVM session.
   */
  svmWallet: Wallet | null;
  isConnectPending: boolean;
  connectError: Error | null;
};

const ActiveAccountContext = createContext<UseActiveAccountResult | null>(null);

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const {
    connected: evmConnected,
    connector: evmConnector,
    connectors: evmConnectors,
    isConnectPending: evmIsConnectPending,
    connectError: evmConnectError,
    connect: evmConnect,
    disconnect: evmDisconnect,
    switchChain: evmSwitchChain,
  } = useEvmAccountAdapter();
  const {
    connected: svmConnected,
    wallet: svmWallet,
    isConnectPending: svmIsConnectPending,
    connectError: svmConnectError,
    connect: svmConnect,
    disconnect: svmDisconnect,
    clear: svmClear,
  } = useSvmAccountAdapter();
  const [wallets, setWallets] = useState<readonly SvmDiscoveredWallet[]>([]);
  const disconnectPendingRef = useRef(false);

  useEffect(() => {
    const refresh = () => {
      setWallets(listDiscoveredSvmWallets());
    };
    refresh();
    return subscribeSvmWalletDiscovery(refresh);
  }, []);

  // Observed EVM while SVM live was not user-initiated (dispatchConnect clears
  // SVM before EVM connect) — disconnect wagmi. At most one disconnect per
  // conflict via disconnectPending in the decision input (ref, not a timer).
  useEffect(() => {
    const decision = decideObservedFamilyConflict({
      svmLive: Boolean(svmConnected),
      evmConnected: Boolean(evmConnected),
      disconnectPending: disconnectPendingRef.current,
    });
    if (decision.action !== "disconnect_evm") return;
    disconnectPendingRef.current = true;
    void evmDisconnect().finally(() => {
      disconnectPendingRef.current = false;
    });
  }, [svmConnected, evmConnected, evmDisconnect]);

  const account = useMemo((): ActiveAccount => {
    if (svmConnected) return svmConnected;
    if (evmConnected) return evmConnected;
    return DISCONNECTED_ACCOUNT;
  }, [evmConnected, svmConnected]);

  const connect = useCallback(
    async (target: ConnectTarget) => {
      await dispatchConnect(target, {
        clearSvm: svmClear,
        onEvmConnect: evmConnect,
        onEvmDisconnect: evmDisconnect,
        onSvmConnect: svmConnect,
        evmConnected: Boolean(evmConnected),
      });
    },
    [svmClear, evmConnect, evmDisconnect, svmConnect, evmConnected],
  );

  const disconnect = useCallback(async () => {
    if (svmConnected) {
      await svmDisconnect();
      return;
    }
    if (evmConnected) {
      await evmDisconnect();
    }
  }, [svmConnected, evmConnected, svmDisconnect, evmDisconnect]);

  const switchChain = useCallback(
    async (chainId: number) => {
      if (!evmConnected) {
        throw new Error("switchChain: no EVM session");
      }
      await evmSwitchChain(chainId);
    },
    [evmConnected, evmSwitchChain],
  );

  const connectOptions = useMemo((): readonly ConnectOption[] => {
    const options: ConnectOption[] = [];
    for (const connector of evmConnectors) {
      options.push({
        family: "evm",
        key: `evm:${connector.uid}`,
        label: evmConnectorLabel(connector),
        connector,
      });
    }
    for (const wallet of wallets) {
      options.push({
        family: "svm",
        key: `svm:${wallet.name}`,
        label: wallet.name,
        walletName: wallet.name,
      });
    }
    return options;
  }, [evmConnectors, wallets]);

  const signingBinding = useMemo(
    () => requireEvmSigningBinding(account, evmConnector),
    [account, evmConnector],
  );

  const value = useMemo(
    (): UseActiveAccountResult => ({
      account,
      address: connectedAddress(account),
      isConnected: isAccountConnected(account),
      disconnect,
      connect,
      switchChain,
      connectOptions,
      signingBinding,
      svmWallet,
      isConnectPending: evmIsConnectPending || svmIsConnectPending,
      connectError: svmConnectError ?? evmConnectError,
    }),
    [
      account,
      disconnect,
      connect,
      switchChain,
      connectOptions,
      signingBinding,
      svmWallet,
      evmIsConnectPending,
      svmIsConnectPending,
      svmConnectError,
      evmConnectError,
    ],
  );

  return (
    <ActiveAccountContext.Provider value={value}>
      {children}
    </ActiveAccountContext.Provider>
  );
}

/** Context read — adapters are never called here. */
export function useActiveAccountFromProvider(): UseActiveAccountResult {
  const ctx = useContext(ActiveAccountContext);
  if (!ctx) {
    throw new Error(
      "useActiveAccount must be used within ActiveAccountProvider",
    );
  }
  return ctx;
}
