# 0006 — SVM client is Kit + Wallet Standard

## Context

Two Solana client stacks in the product graph force duplicate adapters and let `@solana/web3.js` leak into UI and hooks. Wallet signing must use one port.

## Decision

The SVM product client stack is **`@solana/kit` + Wallet Standard**. `@solana/web3.js` is banned in product roots (`app/`, `components/`, `lib/`, `hooks/`).

- Write owner: [`lib/web3/svm-write-adapter.ts`](../../lib/web3/svm-write-adapter.ts) (Kit assembly; `SvmSignAndSendPort` / `solana:signAndSendTransaction` only).
- Ban enforcement: [`test/solana-web3-app-graph-policy.test.ts`](../../test/solana-web3-app-graph-policy.test.ts); forbidden list in [`AGENTS.md`](../../AGENTS.md).
- Choke-point: `svm-write-adapter` in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts).

## One rejected alternative and why

Keep `@solana/web3.js` beside Kit “until migration finishes.” Rejected: a second stack becomes permanent; graph policy cannot stay red on a known exception.

## Consequences

New SVM product code imports Kit and the write adapter only. Scripts or tests outside product roots that still need legacy packages do not re-open the app graph. Wallet rejection stays on the dedicated owner.

## Status

Accepted
