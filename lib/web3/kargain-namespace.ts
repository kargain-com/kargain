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

/** SPEC §13.1 reserved band for non-EVM commercial namespaces (Postgres int4 max). */
export const NON_EVM_NAMESPACE_MIN = 2_000_000_000;
export const NON_EVM_NAMESPACE_MAX = 2_147_483_647;

export function isReservedNonEvmNamespace(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= NON_EVM_NAMESPACE_MIN &&
    value <= NON_EVM_NAMESPACE_MAX
  );
}

/**
 * Ingress: namespace = 2_000_000_000 + LayerZero EID (SPEC §13.1).
 * Returns a bare number — does not mint a registry row.
 */
export function namespaceFromLayerZeroEid(eid: number): number {
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new Error(`Invalid LayerZero EID: ${eid}`);
  }
  const namespace = NON_EVM_NAMESPACE_MIN + eid;
  if (namespace > NON_EVM_NAMESPACE_MAX) {
    throw new Error(
      `LayerZero EID ${eid} overflows the reserved namespace band (max ${NON_EVM_NAMESPACE_MAX})`,
    );
  }
  return namespace;
}
