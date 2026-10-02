/**
 * Pure chrome helpers for Result {@link evmWagmiChain} — soft-disable formulas
 * shared by panels/hooks (N1). Never throw; never invent a chain id.
 */

import { isCommercialEip155Id, type Eip155ChainId } from "@/lib/web3/commercial-active";
import type {
  EvmWagmiChainResult,
  KargainWriteUnionChainId,
} from "@/lib/web3/supported-chains";

/** True when an EVM session is on a different wallet chain than the wagmi target. */
export function wrongChainFromWagmi(
  evmSessionOk: boolean,
  walletChainId: number | undefined,
  wagmi: EvmWagmiChainResult,
): boolean {
  return (
    evmSessionOk &&
    wagmi.ok &&
    walletChainId !== undefined &&
    walletChainId !== wagmi.chainId
  );
}

/** Write-union id when the door admits; undefined when soft-disabled. */
export function wagmiWriteUnionId(
  wagmi: EvmWagmiChainResult,
): KargainWriteUnionChainId | undefined {
  return wagmi.ok ? wagmi.chainId : undefined;
}

/**
 * Branded EIP-155 id for ActiveAccount.switchChain when the door admits.
 * WriteUnion alone is `number` under viem — cannot invent-ban a bare namespace.
 */
export function eip155WhenWagmiOk(
  wagmi: EvmWagmiChainResult,
): Eip155ChainId | undefined {
  return wagmi.ok ? wagmi.eip155 : undefined;
}

/** ERC-20 decimals read only when needed and the namespace admits EVM wagmi. */
export function erc20DecimalsQueryEnabled(
  needsErc20Decimals: boolean | null | undefined,
  wagmi: EvmWagmiChainResult,
): boolean {
  return Boolean(needsErc20Decimals) && wagmi.ok;
}

/** Wallet-client / public-client chain opts — empty object when door refuses. */
export function wagmiChainIdOpts(
  wagmi: EvmWagmiChainResult,
): { chainId: number } | Record<string, never> {
  return wagmi.ok ? { chainId: wagmi.chainId } : {};
}

/** Write / finalize click admitted only when wagmi door is ok. */
export function evmWagmiWriteAdmitted(wagmi: EvmWagmiChainResult): boolean {
  return wagmi.ok;
}

/**
 * KarPro on-chain profile keyed reads — false when namespace refuses wagmi
 * (never invent a chain id for staking/pass reads).
 */
export function karProOnChainReadsEnabled(args: {
  enabled: boolean;
  address: string | undefined;
  chainId: number | undefined;
  proPassConfigured: boolean;
  stakingConfigured: boolean;
  wagmi: EvmWagmiChainResult;
}): boolean {
  const wc =
    args.chainId != null ? wagmiWriteUnionId(args.wagmi) : undefined;
  return Boolean(
    args.enabled &&
      args.address &&
      args.chainId != null &&
      args.proPassConfigured &&
      args.stakingConfigured &&
      wc != null,
  );
}

/**
 * Peer identity membership scope — commercial EIP-155 only; SVM / missing → null
 * (roster anyActive path, no staking read).
 */
export function peerIdentityMembershipChainId(
  optionsChainId: number | null | undefined,
): number | null {
  return optionsChainId != null &&
    Number.isFinite(optionsChainId) &&
    isCommercialEip155Id(optionsChainId)
    ? optionsChainId
    : null;
}

/**
 * Peer identity staking `chainId` for wagmi — undefined when membership absent
 * or wagmi door refuses.
 */
export function peerIdentityStakingChainId(
  membershipChainId: number | null,
  wagmi: EvmWagmiChainResult,
): KargainWriteUnionChainId | undefined {
  return membershipChainId != null ? wagmiWriteUnionId(wagmi) : undefined;
}
