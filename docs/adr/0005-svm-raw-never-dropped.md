# 0005 — `kargain_svm_raw` is never dropped

## Context

Public Solana RPC is not a production history guarantee. If a projection rebuild needed deep chain replay, a schema change or outage could lose indexed truth that the product already observed.

## Decision

The append-only schema **`kargain_svm_raw` is never dropped**. The projection schema is dropped and replayed from raw (no RPC).

- Raw INSERT owner: [`svm-ingest/svm-raw-writer.ts`](../../svm-ingest/svm-raw-writer.ts).
- Rebuild: [`svm-ingest/projection-rebuild.ts`](../../svm-ingest/projection-rebuild.ts) (`rebuildProjectionFromRaw`); projection drop in the projection writer path.
- Choke-points: `svm-raw-ingest` and `svm-projection-replay-digest` in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts).
- SPEC: [§13.12](../contracts/SPEC.md#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative) (projection rebuild from raw). Ponder retention must not treat raw as disposable ([ADR 0016](./0016-one-writer-schema-per-indexing-identity.md)).

## One rejected alternative and why

Drop both raw and projection on reindex and refill from RPC. Rejected: catch-up beyond a bounded lag is an incident; deep history is not guaranteed.

## Consequences

Ops may rebuild projection freely. Dropping `kargain_svm_raw` is an incident, not a runbook step. Indexer schema evolution for SVM projection assumes raw is intact.

## Status

Accepted
