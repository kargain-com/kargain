"use client";

import { useEffect, useState } from "react";

import {
  readAccountKindFromProvider,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";

type ConnectorLike = {
  getProvider?: () => Promise<unknown>;
} | undefined;

export function useWalletAccountKind(
  address: `0x${string}` | undefined,
  connector: ConnectorLike,
): { kind: WalletAccountKind | null; isLoading: boolean } {
  const [kind, setKind] = useState<WalletAccountKind | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(address));

  useEffect(() => {
    if (!address) {
      setKind(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const provider = await connector?.getProvider?.();
        const resolved = await readAccountKindFromProvider(provider, address);
        if (!cancelled) setKind(resolved);
      } catch {
        if (!cancelled) setKind("eoa");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, connector]);

  return { kind, isLoading };
}
