"use client";

/**
 * Sole React entry for "who is connected" (S8-2-fix).
 * Returns the discriminated account + family-parameterized actions.
 * EVM-shaped members live in {@link requireEvmSession} owners, not here.
 */

import { useCallback, useMemo } from "react";
import type { Connector } from "wagmi";

import {
  connectedAddress,
  isAccountConnected,
  requireEvmSigningBinding,
  type AccountSigningBinding,
  type ActiveAccount,
  type ConnectOption,
  type ConnectTarget,
} from "@/lib/web3/active-account";
import { useEvmAccountAdapter } from "@/lib/web3/evm-account-adapter";
import { useSvmAccountAdapter } from "@/lib/web3/svm-account-adapter";

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
  isConnectPending: boolean;
  connectError: Error | null;
};

export function useActiveAccount(): UseActiveAccountResult {
  const evm = useEvmAccountAdapter();
  const svm = useSvmAccountAdapter();

  const account = useMemo((): ActiveAccount => {
    if (svm.connected) return svm.connected;
    if (evm.connected) return evm.connected;
    return { status: "disconnected" };
  }, [evm.connected, svm.connected]);

  const connect = useCallback(
    async (target: ConnectTarget) => {
      if (target.family === "evm") {
        svm.clear();
        await evm.connect(target.connector);
        return;
      }
      if (evm.connected) {
        await evm.disconnect();
      }
      await svm.connect(target.walletName);
    },
    [evm, svm],
  );

  const disconnect = useCallback(async () => {
    if (svm.connected) {
      await svm.disconnect();
      return;
    }
    if (evm.connected) {
      await evm.disconnect();
    }
  }, [evm, svm]);

  const switchChain = useCallback(
    async (chainId: number) => {
      if (!evm.connected) {
        throw new Error("switchChain: no EVM session");
      }
      await evm.switchChain(chainId);
    },
    [evm],
  );

  const connectOptions = useMemo((): readonly ConnectOption[] => {
    const options: ConnectOption[] = [];
    for (const connector of evm.connectors) {
      options.push({
        family: "evm",
        key: `evm:${connector.uid}`,
        label: evmConnectorLabel(connector),
        connector,
      });
    }
    for (const wallet of svm.wallets) {
      options.push({
        family: "svm",
        key: `svm:${wallet.name}`,
        label: wallet.name,
        walletName: wallet.name,
      });
    }
    return options;
  }, [evm.connectors, svm.wallets]);

  const signingBinding = useMemo(
    () => requireEvmSigningBinding(account, evm.connector),
    [account, evm.connector],
  );

  return {
    account,
    address: connectedAddress(account),
    isConnected: isAccountConnected(account),
    disconnect,
    connect,
    switchChain,
    connectOptions,
    signingBinding,
    isConnectPending: evm.isConnectPending || svm.isConnectPending,
    connectError: svm.connectError ?? evm.connectError,
  };
}

export type {
  ActiveAccount,
  ActiveAccountEvm,
  ActiveAccountSvm,
  AccountSigningBinding,
  ConnectOption,
  ConnectTarget,
  CommercialNamespaceResult,
  EvmSessionResult,
  EvmSwitchChainAvailability,
} from "@/lib/web3/active-account";
export {
  commercialNamespaceOf,
  connectedAddress,
  evmSessionRefusalCopy,
  evmSessionRefusalTitle,
  evmSwitchChainAvailability,
  isAccountConnected,
  requireEvmSession,
  requireEvmSigningBinding,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
export type { EvmSessionCause, WalletFamilyWanted } from "@/lib/web3/active-account";
