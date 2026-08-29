# Kargain documentation (public)

Start here. Each area has **one canonical document**; other files link in — they do not repeat tables or procedures.

## Contracts (on-chain)

| Document | Purpose |
|----------|---------|
| [contracts/SPEC.md](./contracts/SPEC.md) | **Single specification** — generation v2 (current), v1.x (historical), metadata JSON, addresses |
| [contracts/README.md](./contracts/README.md) | How to read the spec |

**Addresses:** [SPEC I.9.1](./contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) (84532) · [SPEC I.9.2](./contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) (11155111) · [SPEC Part II.4](./contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532) (historical)

**Audit on-chain source:** when Basescan / Etherscan show verified source, use those explorer pages. For parallel stacks (not yet live in the app), [Sourcify](https://repo.sourcify.dev) also publishes Match records — see [nuclear-6.md](./ops/deploys/nuclear-6.md) (current parallel) and [nuclear-7.md](./ops/deploys/nuclear-7.md) (next redeploy).

## Indexer (Ponder)

| Document | Purpose |
|----------|---------|
| [indexer/README.md](./indexer/README.md) | Which indexer doc to read when |
| [indexer/MIGRATION-V2.md](./indexer/MIGRATION-V2.md) | v2 handler reference; Nuclear dual-chain / C3; FX display layer (§6) |
| [indexer/OPERATIONS.md](./indexer/OPERATIONS.md) | **Permanent** — VPS reindex runbook (hub **44957457** + Eth **11404204**) |

## UI

| Document | Purpose |
|----------|---------|
| [design-spec.md](./design-spec.md) | UI layout, tokens, components — Instrument Layer §10–§13; passport tabs + right-rail Discussion (§4.14, §13.6–§13.7); **Messages** session / consent / devices (§4.12, I1–I20) |

**Reading order:** foundation §1–9 → Instrument rules §10 → philosophy §11 → shipped roadmap §12 → mobile §13.

## Deploy records

| Document | Purpose |
|----------|---------|
| [ops/deploys/nuclear-4.md](./ops/deploys/nuclear-4.md) | **Current live app** — Nuclear #4 full commercial stack (84532 + 11155111), August 2026 |
| [ops/deploys/nuclear-6.md](./ops/deploys/nuclear-6.md) | Parallel Nuclear #6 (URI ceiling) — Sourcify Match; explorers unverified |
| [ops/deploys/nuclear-7.md](./ops/deploys/nuclear-7.md) | Parallel Nuclear #7 — Sourcify Exact Match; Basescan/Etherscan still red for Passport/Staking/Gateway |
| [ops/deploys/archive/](./ops/deploys/archive/) | **Historical** — Nuclear #2/#3, June v2, AuctionEscrow, pre-Nuclear bridge pathway |
| [ops/deploys/multichain-browser-e2e-checklist.md](./ops/deploys/multichain-browser-e2e-checklist.md) | Maintainer dual-chain browser/ops checklist (testnet) |
| [ops/deploys/phase2-checkpoint-dossier.md](./ops/deploys/phase2-checkpoint-dossier.md) | §7.6 Phase 2 mainnet dossier — prepared, not activated |
| [ops/recovery-bridge.md](./ops/recovery-bridge.md) | Bridge recovery ops (testnet EOA vs mainnet Timelock) |

## Product onboarding

[README.md](../README.md) — setup, architecture, routes (links here for depth).
