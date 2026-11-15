# 0007 — Branded `Eip155ChainId` for EVM-only doors

## Context

Passing bare `number` into EVM RPC, viem, and Wagmi doors accepts a Solana namespace or any integer and fails late—or worse, treats it as an EIP-155 id. Multi-VM code needs a type boundary at EVM-only APIs.

## Decision

EVM-only doors take branded **`Eip155ChainId`**, minted only through registry constructors.

- Brand and constructors: [`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts) (`Eip155ChainId`, `evmChainOf`, `resolveEvmChain`).
- Doors: choke-point `eip155-chain-doors` in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts) (owners include [`lib/web3/supported-chains.ts`](../../lib/web3/supported-chains.ts) and related public/bridge clients).
- Policy: [`test/eip155-chain-door-policy.test.ts`](../../test/eip155-chain-door-policy.test.ts).

## One rejected alternative and why

Use unbranded `number` everywhere and document “callers must pass EIP-155.” Rejected: documentation is not a type boundary; a second VM makes the mistake systemic.

## Consequences

Components do not cast to `Eip155ChainId`. Soft doors return `!ok` for non-EVM namespaces; write owners refuse by name. Hardhat `31337` stays on the private write-union path, not as a commercial brand mint.

## Status

Accepted
