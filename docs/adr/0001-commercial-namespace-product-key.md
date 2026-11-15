# 0001 — Product key is the commercial namespace

## Context

The product spans EVM and non-EVM commercial networks. EIP-155 `chainId` is not a universal key: Solana and other LayerZero endpoints have no EIP-155 identity. Without one product key, UI, indexer, and bridge code fork on VM or invent silent hub defaults.

## Decision

The product key is the **commercial namespace** (`KargainNamespace`), never bare `chainId`.

- For EVM commercial rows today, the namespace number equals the EIP-155 chain id.
- For non-EVM commercial networks, `namespace = 2_000_000_000 + LayerZero EID` ([SPEC §I.13](../contracts/SPEC.md#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative)).
- Brand and band: [`lib/web3/kargain-namespace.ts`](../../lib/web3/kargain-namespace.ts) (`KargainNamespace`, `NON_EVM_NAMESPACE_MIN`, `mintKargainNamespace`).
- EID → namespace owner: [`lib/web3/commercial-eid-namespace.ts`](../../lib/web3/commercial-eid-namespace.ts) (`commercialNamespaceFromLayerZeroEid`); unknown EID fails closed.
- Registry rows: [`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts).
- Choke-point: `layerzero-eid-namespace` in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts).

## One rejected alternative and why

Key the product on EIP-155 `chainId` everywhere and invent a fake chain id for Solana. Rejected: it collides with real EVM ids, breaks explorer and wallet semantics, and hides the LayerZero EID that already identifies the network.

## Consequences

Components and hooks take namespaces (or branded EVM doors where EVM-only). A second VM does not get a parallel key. Registry and SPEC §I.9 rows must stay keyed by namespace.

## Status

Accepted
