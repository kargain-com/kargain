# Contributing to Kargain

Thank you for your interest. Kargain is MIT licensed. This repo is the app,
contracts, and indexer consumer; protocol proposals live in
[kargain-com/kips](https://github.com/kargain-com/kips).

## Before you start

| You want to change… | Start here |
|---------------------|------------|
| A **protocol standard** (metadata schema, identity rules, staking semantics) | [KIP-1](https://github.com/kargain-com/kips/blob/master/kip-0001.md) → PR in `kips` |
| **App UI** | [design-spec.md](docs/design-spec.md) + this file |
| **Smart contracts** | [contracts/SPEC.md](docs/contracts/SPEC.md) + `contracts/` |
| **Ponder migration** | [indexer/MIGRATION-V2.md](docs/indexer/MIGRATION-V2.md) |
| **Ponder reindex** | [indexer/OPERATIONS.md](docs/indexer/OPERATIONS.md) |
| **All public docs** | [docs/README.md](docs/README.md) |

Open a GitHub issue before large or ambiguous work. Small fixes (typos, clear bugs) can go straight to a PR.

## Development setup

See [README.md](README.md) § Development setup. Minimum:

```bash
git clone https://github.com/kargain-com/kargain.git
cd kargain
pnpm install
cp .env.example .env.local
pnpm dev
```

For full on-chain + indexer local stack: `./scripts/dev-local.sh` (see README).

## Verify before opening a PR

```bash
pnpm build
pnpm tsc --noEmit
```

Add or update tests when behavior changes (`pnpm hardhat test`, `node --import tsx --test test/*.test.ts`).

## UI contributions

Follow [design-spec.md](docs/design-spec.md):

- Tailwind tokens from `app/globals.css` — no arbitrary hex
- No `box-shadow` except `var(--focus-ring)` on `:focus-visible`
- No `font-semibold` / `font-bold` for emphasis (max weight 500)
- Sentence case in UI copy
- Reuse `components/ui/*` (`Button`, `Input`, `Select`, `Card`, …)

## Contract contributions

- Behavior must match [contracts/SPEC.md](docs/contracts/SPEC.md); update the same file in the PR
- Base Sepolia addresses: [SPEC Part I.9.1](docs/contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) only — do not duplicate elsewhere
- Do not hardcode single-network assumptions; use `deployment-addresses.ts` + env `*_BY_CHAIN`

## Pull request expectations

- One logical change per PR when possible
- Describe **why**, not only what
- Link related issue or KIP number if applicable
- No secrets (`.env`, keys) in commits
- No `console.log` left in production paths

## Philosophy (summary)

Kargain follows **rough consensus and running code** ([KIP-1](https://github.com/kargain-com/kips/blob/master/kip-0001.md)):

- Standards-track KIPs need working implementation before `Final`
- Disagreement is resolved by fork + code, not token voting
- Maintainer roles grow from sustained, merged contribution

## Questions

Use [GitHub Issues](https://github.com/kargain-com/kargain/issues) in this repo for bugs and app features.
Use [kips issues](https://github.com/kargain-com/kips/issues) for protocol proposals.
