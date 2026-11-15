# 0004 — Full protocol parity on Solana

## Context

Solana is a commercial network, not a thin bridge sidecar. A reduced Solana surface would force VM forks in product code and make custody and settlement rules differ by chain.

## Decision

Solana runs the **identical commercial stack** and is both an autonomous commercial network and a bridge endpoint.

- Identical stack on every commercial chain: passport, KarPro, staking, both consignment types, one bridge gateway ([SPEC §I.12.1](../contracts/SPEC.md#121-model)).
- Model constants are identical bytecode on every chain and change only by SPEC revision plus redeploy; locally governed parameters change only through that chain’s own Timelock and are non-portable ([SPEC §I.13.10](../contracts/SPEC.md#1310-protocol-parameter-model-three-tiers)).
- Live row: [SPEC §I.9.3](../contracts/SPEC.md#i93-active-deployment-solana-devnet-2000040168) (namespace `2000040168`); star spoke under [SPEC §I.13.5](../contracts/SPEC.md#135-star-topology-with-n-spokes).
- Dual-VM product owners include choke-points `svm-program-events` and `svm-write-adapter` in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts).

## One rejected alternative and why

Ship Solana as bridge-only (lock/mint without local marketplace and staking). Rejected: custody and trust rules would fork by VM, and the product would need Solana-special paths forever.

## Consequences

SVM programs and the EVM stack stay behaviorally aligned under SPEC Part I. New commercial features land on both VMs or are not commercial. The Solana namespace is a first-class registry key, not a bolt-on id.

## Status

Accepted
