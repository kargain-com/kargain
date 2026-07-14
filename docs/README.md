# Kargain documentation (public)

Start here. Each area has **one canonical document**; other files link in — they do not repeat tables or procedures.

## Contracts (on-chain)

| Document | Purpose |
|----------|---------|
| [contracts/SPEC.md](./contracts/SPEC.md) | **Single specification** — generation v2 (current), v1.x (historical), metadata JSON, addresses |
| [contracts/README.md](./contracts/README.md) | How to read the spec |

**Addresses:** [SPEC Part I.9.1](./contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) (active) · [SPEC Part II.4](./contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532) (historical)

## Indexer (Ponder)

| Document | Purpose |
|----------|---------|
| [indexer/README.md](./indexer/README.md) | Which indexer doc to read when |
| [indexer/MIGRATION-V2.md](./indexer/MIGRATION-V2.md) | v2 handler reference; FX display layer (§6); agent consignment API + UI (§6) |
| [indexer/MIGRATION-AUCTION.md](./indexer/MIGRATION-AUCTION.md) | AuctionEscrow tables (incl. agent auth), events, per-contract start block 44080895 |
| [indexer/OPERATIONS.md](./indexer/OPERATIONS.md) | **Permanent** — VPS reindex runbook |

## UI

| Document | Purpose |
|----------|---------|
| [design-spec.md](./design-spec.md) | UI layout, tokens, components — Instrument Layer §10–§13; passport tabs + right-rail Discussion (§4.14, §13.6–§13.7) |

**Reading order:** foundation §1–9 → Instrument rules §10 → philosophy §11 → shipped roadmap §12 → mobile §13.

## Deploy records

| Document | Purpose |
|----------|---------|
| [ops/deploys/84532-v2.md](./ops/deploys/84532-v2.md) | June 2026 generation v2 deploy — smoke/verify + **completed** VPS cutover |
| [ops/deploys/84532-auction.md](./ops/deploys/84532-auction.md) | July 2026 AuctionEscrow additive deploy on 84532 |

## Product onboarding

[README.md](../README.md) — setup, architecture, routes (links here for depth).
