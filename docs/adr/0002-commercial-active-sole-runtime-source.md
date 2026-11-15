# 0002 — Commercial registry is the sole runtime source

## Context

Addresses, program ids, and start blocks must match what is live. If indexing or the product can take those values from the environment or from `deployments/<chainId>.json`, a green deploy can index a stack the registry does not name, and a local override can look like production truth.

## Decision

[`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts) (`COMMERCIAL_ACTIVE`) is the only runtime source of commercial addresses, program ids, and start blocks on every VM.

- Ponder commercial resolution: [`scripts/lib/resolve-sepolia-stack.ts`](../../scripts/lib/resolve-sepolia-stack.ts) (`resolveCommercialStack` → `requireEvmCommercialActive` only).
- SVM ingest: [`lib/svm/ingest-config.ts`](../../lib/svm/ingest-config.ts) — `resolveIngestCommercialStack` (EID → namespace → `requireSvmCommercialActive`), `followedProgramsFromStack`, `resolveIngestStartSlot`.
- Deploy preflight refuses commercial `PONDER_START_BLOCK*` and any `PONDER_*_ADDRESS` ([`scripts/lib/ponder-indexing-env-census.ts`](../../scripts/lib/ponder-indexing-env-census.ts) `ponderDeployEnvRefusal`; [`scripts/ponder-deploy-preflight.ts`](../../scripts/ponder-deploy-preflight.ts)).
- Regression: [`test/commercial-active.test.ts`](../../test/commercial-active.test.ts) — planted commercial manifests and removed env keys leave `resolveCommercialStack` and the indexing config unchanged.
- Local Hardhat (`31337`) may still use local address and start-block keys; that path does not change commercial rows ([ADR 0016 §a](./0016-one-writer-schema-per-indexing-identity.md)).

## One rejected alternative and why

Keep env and `deployments/<chainId>.json` as overrides “for ops convenience.” Rejected: an override changes indexing identity without a reviewed registry change and can make production look successful while reading the wrong stack.

## Consequences

A commercial address or start block changes only through a registry PR. Deploy-machine manifest asserts stay outside the runtime graph. SVM ingest program ids and start slots read the same registry.

## Status

Accepted
