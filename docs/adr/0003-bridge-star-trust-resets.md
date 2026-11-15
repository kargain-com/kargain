# 0003 — Bridge is a star; trust resets on every crossing

## Context

Multi-chain custody needs one topology and one trust rule. Mesh peer pathways and “preserve verification across a hop” both produce usable copies or trust that the destination did not earn.

## Decision

- The bridge is **star-only** through the gateway hub: hub↔spoke only; spoke↔spoke is two hops via the hub ([SPEC §I.12](../contracts/SPEC.md#i12-multi-chain-architecture-normative)).
- **Trust never survives a crossing**: every landing is UNVERIFIED in both directions ([SPEC §12.3](../contracts/SPEC.md#123-trust-never-survives-a-crossing-supersedes-75-preserved-on-return)).
- Owners: [`lib/web3/bridge/bridge-config.ts`](../../lib/web3/bridge/bridge-config.ts) (`admitBridgeCrossingRoute`, `resolveBridgeRoute`); choke-point `bridge-route-resolver` in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts).

## One rejected alternative and why

Preserve verification status when unlocking at home (“trust returns with the passport”). Rejected: verification is chain-local; a foreign KarPro must not underwrite home trust after a hop.

## Consequences

Product and gateway code refuse non-star routes. UI and indexer treat post-crossing status as unverified until a local re-verify. Adding a spoke updates the star membership, not a mesh of peers.

## Status

Accepted
