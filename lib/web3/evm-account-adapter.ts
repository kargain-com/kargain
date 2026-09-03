"use client";

/**
 * Sole product caller of wagmi account hooks (S8-2).
 * All other product code consumes {@link useActiveAccount}.
 */

import { useCallback, useMemo } from "react";
import { getAddress } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from "wagmi";

import {
  mintKargainNamespace,
  type KargainNamespace,
} from "@/lib/web3/kargain-namespace";
import { commercialActive } from "@/lib/web3/commercial-active";
import type { ActiveAccountEvm } from "@/lib/web3/active-account";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export type EvmAccountAdapterSnapshot = {
  connected: ActiveAccountEvm | null;
  /** Active wagmi connector when an EVM session is live. */
  connector: Connector | undefined;
  connectors: readonly Connector[];
  isConnectPending: boolean;
  connectError: Error | null;
  connect: (connector: Connector) => Promise<void>;
  disconnect: () => Promise<void>;
  switchChain: (chainId: number) => Promise<void>;
};

function namespaceForEvmChain(chainId: number): KargainNamespace {
  const stack = commercialActive(chainId);
  if (stack) return stack.namespace;
  return mintKargainNamespace(chainId);
}

/**
 * EVM wallet session adapter — wraps wagmi account/connect/switch hooks.
 * Must remain the only product import site for those hooks.
 */
export function useEvmAccountAdapter(): EvmAccountAdapterSnapshot {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors, isPending, error } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const connected = useMemo((): ActiveAccountEvm | null => {
    if (!isConnected || !address) return null;
    let checksum: `0x${string}`;
    try {
      checksum = getAddress(address);
    } catch {
      return null;
    }
    return {
      status: "connected",
      vm: "evm",
      address: checksum,
      namespace: namespaceForEvmChain(chainId),
      chainId,
    };
  }, [address, chainId, isConnected]);

  const connect = useCallback(
    async (connector: Connector) => {
      await connectAsync({ connector });
    },
    [connectAsync],
  );

  const disconnect = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const switchChain = useCallback(
    async (targetChainId: number) => {
      if (!switchChainAsync) {
        throw new Error("EVM chain switch is unavailable");
      }
      await switchChainAsync({ chainId: wagmiChainId(targetChainId) });
    },
    [switchChainAsync],
  );

  return {
    connected,
    connector: connected ? connector : undefined,
    connectors,
    isConnectPending: isPending,
    connectError: error ?? null,
    connect,
    disconnect,
    switchChain,
  };
}
