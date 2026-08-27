/**
 * Nominal commercial-network namespace (SPEC §I.13.1).
 *
 * For EVM stacks today, namespace number equals EIP-155 chain id.
 * Only the commercial registry (or an explicit ingress parser) may mint values.
 * Resolvers keep `number` in public signatures — do not thread this brand into components.
 */

declare const kargainNamespaceBrand: unique symbol;

export type KargainNamespace = number & {
  readonly [kargainNamespaceBrand]: void;
};

/** Mint a namespace — registry / ingress only. */
export function mintKargainNamespace(value: number): KargainNamespace {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid KargainNamespace: ${value}`);
  }
  return value as KargainNamespace;
}

/** Narrow a number that is already known to be a registry key. */
export function asKargainNamespace(value: number): KargainNamespace {
  return value as KargainNamespace;
}
