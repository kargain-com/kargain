# Ponder indexer documentation

| Document | Lifecycle | You need it when… |
|----------|-----------|-------------------|
| [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | **Reference** | v2 event/schema mapping, FX display extension (§6) |
| [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | **Per deploy** | June 2026 v2 deploy + VPS cutover record |

**Production (June 2026):** [ponder.kargain.com](https://ponder.kargain.com) indexes generation v2 contracts from block **43399242** with v2 event handlers (including return flow and dispute deposit). **Reindex required** after deploying handler/schema changes.

## Contract addresses for indexer

Do **not** copy address tables here. Resolution order:

- Committed: `lib/web3/sepolia-addresses.ts` (`SEPOLIA_ACTIVE`) — **VPS uses this after `git pull`**
- Local manifest: `deployments/84532.json` (not in git — deploy machine only)
- Diagnostic: `pnpm ponder:config`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532)

**Start block:** `PONDER_START_BLOCK_84532=43399242` (`SEPOLIA_ACTIVE.indexFromBlock`).

## Verifier lifecycle (bounded indexing)

Ponder observes a **bounded event window** (start block, reindex checkpoints). KarProPass / KarProStaking handlers use [`src/lib/ponder-verifier-lifecycle.ts`](../../src/lib/ponder-verifier-lifecycle.ts): **creation** events (`ProPassMinted`, `VerifierJoined`) upsert `verifier` rows; **mutation** and **deactivation** events (`ProfileUpdated`, `VerificationFeeUpdated`, `ProPassBurned`, `VerifierLeft`) patch only when a row exists — no row means the desired inactive/absent state already holds (idempotent no-op, not an error).

## Listing API fields (v2)

Ponder stores `currencyCode`, `agent`, `agentFeeBps`, `returnRequestedAt`, and `externalPaymentConfirmedAt` on listings. HTTP API also returns legacy `fiatCurrency: 0|1` (USD/EUR) for existing frontend — see `lib/marketplace/currency-code.ts`.

Passport rows include trust fields (`hadDispute`, `disputeOpenedAt`, …) and nullable `disputeDeposit` (set on `DisputeDepositPaid`, cleared on resolve/withdraw).

## HTTP API

Custom routes live in [`src/api/index.ts`](../../src/api/index.ts). Bigints are serialized as strings in JSON.

| Endpoint | Purpose |
|----------|---------|
| `GET /listings` | Browse and filter (optional FX query params for cross-currency filter/sort) |
| `GET /listings/stats` | Aggregate listing stats |
| `GET /listings/facets` | Filter facets (make, status, condition, …) |
| `GET /listings/:tokenId` | Listing detail |
| `GET /listings/batch` | Batch listing lookup |
| `GET /passports/:tokenId` | Passport detail |
| `GET /passports/batch` | Batch passport lookup |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /profile/:address/listings` | Listings by seller |
| `GET /notifications/:address` | Notification feed |
| `GET /verifiers` | Verifier directory |
| `GET /verifiers/:address` | Verifier profile |
| `GET /verifiers/by-slug/:slug` | Resolve slug → address |
| `GET /verifiers/:address/attestations` | Verifier attestations |

### Ponder reserved routes

Do **not** define these in `src/api/index.ts` — Ponder owns them ([docs](https://ponder.sh/docs/api-reference/ponder/api-endpoints)):

| Route | Purpose |
|-------|---------|
| `GET /health` | Liveness — HTTP 200 when the process is up (may have empty body) |
| `GET /ready` | Readiness — HTTP 503 during backfill, 200 when caught up |
| `GET /status` | Indexing sync status |

Smoke checks after reindex: [OPERATIONS.md §6](./OPERATIONS.md#6-smoke-checks).
