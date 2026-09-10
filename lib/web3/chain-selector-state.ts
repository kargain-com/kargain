import {
  type ActiveAccount,
  type WalletFamilyWanted,
  commercialNamespaceOf,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
import {
  type CommercialRegistry,
  COMMERCIAL_ACTIVE,
  commercialActive,
  nativeUnitOf,
  registeredCommercialNamespaceIds,
} from "@/lib/web3/commercial-active";
import { getViemChain, kargainChains } from "@/lib/web3/supported-chains";

/** True when `chainId` is in the wagmi write-union (`kargainChains`). EVM-only. */
export function isKargainWriteChain(chainId: number): boolean {
  return getViemChain(chainId) != null;
}

export type ChainSelectorState = "ok" | "wrong_network" | "wrong_vm";

export type CommercialPickerEntry = {
  namespace: number;
  label: string;
  vm: "evm" | "svm";
};

/**
 * Full network label for picker / chrome — registry-driven.
 * EVM uses the viem chain name; SVM uses `{symbol} network` (no invented hub name).
 */
export function commercialNetworkLabel(
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): string {
  const stack = commercialActive(namespace, registry);
  if (stack == null) return "Unknown network";
  if (stack.vm === "evm") {
    return getViemChain(stack.chainId)?.name ?? `Chain ${stack.chainId}`;
  }
  return `${nativeUnitOf(stack).symbol} network`;
}

/**
 * Commercial networks for the picker, in registry namespace order.
 * Adding a commercial row to the registry makes it appear without editing the picker.
 */
export function commercialPickerEntries(
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): readonly CommercialPickerEntry[] {
  return registeredCommercialNamespaceIds(registry).map((namespace) => {
    const stack = commercialActive(namespace, registry)!;
    return {
      namespace,
      label: commercialNetworkLabel(namespace, registry),
      vm: stack.vm,
    };
  });
}

/**
 * Three-state chain selector derive (design-spec §4.7).
 * - `wrong_vm` — connected wallet family cannot act on the expected network
 * - `wrong_network` — same VM, wrong commercial network / unsupported EVM chain
 * - `ok` — disconnected, or session commercial namespace matches (or any commercial when unset)
 */
export function deriveChainSelectorState(input: {
  account: ActiveAccount;
  /** Present only when URL/page explicitly requires a namespace — never DEFAULT fallback. */
  expectedNamespace?: number | null;
  registry?: CommercialRegistry;
}): ChainSelectorState {
  const registry = input.registry ?? COMMERCIAL_ACTIVE;
  if (input.account.status !== "connected") return "ok";

  const sessionNs = commercialNamespaceOf(input.account, registry);
  if (!sessionNs.ok) {
    // Connected but not a resolvable commercial namespace (unsupported EVM, etc.).
    if (input.account.vm === "evm") return "wrong_network";
    return "wrong_vm";
  }

  const sessionStack = commercialActive(Number(sessionNs.namespace), registry);
  if (sessionStack == null) return "wrong_network";

  if (input.expectedNamespace == null) return "ok";

  const expectedStack = commercialActive(input.expectedNamespace, registry);
  if (expectedStack == null) {
    // Expected id is not commercial — EVM write-union mismatch stays wrong_network.
    return sessionStack.vm === "evm" ? "wrong_network" : "wrong_vm";
  }

  if (sessionStack.vm !== expectedStack.vm) return "wrong_vm";
  return Number(sessionNs.namespace) === input.expectedNamespace
    ? "ok"
    : "wrong_network";
}

/** Wanted wallet family for wrong_vm copy — family of the expected surface. */
export function chainSelectorWantedFamily(
  expectedNamespace: number | null | undefined,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): WalletFamilyWanted {
  if (expectedNamespace == null) return "evm";
  const stack = commercialActive(expectedNamespace, registry);
  return stack?.vm === "svm" ? "svm" : "evm";
}

/**
 * Selector / action chrome for {@link ChainSelectorState}.
 * `wrong_vm` never offers a network switch — §4.7 family copy only.
 */
export function chainSelectorStateCopy(
  state: ChainSelectorState,
  expectedNamespace?: number | null,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): string | null {
  switch (state) {
    case "ok":
      return null;
    case "wrong_network":
      return "Wrong network";
    case "wrong_vm":
      return wrongVmActionCopy(
        chainSelectorWantedFamily(expectedNamespace, registry),
      );
  }
}

/**
 * EVM write-union chains offered in the wrong-network switch menu.
 * Empty when the selector state is `wrong_vm` — switching cannot change VM.
 * Never lists SVM namespaces.
 */
export function chainSelectorSwitchTargets(
  expectedNamespace?: number | null,
  state?: ChainSelectorState,
): readonly number[] {
  if (state === "wrong_vm") return [];
  if (expectedNamespace != null && isKargainWriteChain(expectedNamespace)) {
    return [expectedNamespace];
  }
  return kargainChains.map((c) => c.id);
}

/**
 * Whether selecting `targetNamespace` may invoke an EVM chain switch.
 * Cross-family and SVM targets never switch.
 */
export function chainSelectorMaySwitchChain(
  account: ActiveAccount,
  targetNamespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): boolean {
  const target = commercialActive(targetNamespace, registry);
  if (target == null || target.vm !== "evm") return false;
  if (account.status !== "connected" || account.vm !== "evm") return false;
  return isKargainWriteChain(target.chainId);
}
