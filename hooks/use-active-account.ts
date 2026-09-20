"use client";

/**
 * Sole React entry for "who is connected" (S8-2-fix / S8-D session store).
 * Context read only — adapters run exactly once inside ActiveAccountProvider.
 * EVM-shaped members live in {@link requireEvmSession} owners, not here.
 */

export {
  ActiveAccountProvider,
  useActiveAccountFromProvider as useActiveAccount,
  type UseActiveAccountResult,
} from "@/lib/web3/active-account-provider";

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
  connectTargetFromOption,
  dispatchConnect,
  evmSessionRefusalCopy,
  evmSessionRefusalTitle,
  evmSwitchChainAvailability,
  isAccountConnected,
  isEvmConnectOption,
  requireEvmSession,
  requireEvmSigningBinding,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
export type { EvmSessionCause, WalletFamilyWanted } from "@/lib/web3/active-account";
