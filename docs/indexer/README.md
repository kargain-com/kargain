# Ponder indexer documentation

| Document | Lifecycle | You need it when… |
|----------|-----------|-------------------|
| [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | **Reference** | v2 event/schema mapping, FX display extension (§6) |
| [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | **Per deploy** | June 2026 v2 deploy + VPS cutover record |

**Production (July 2026 Nuclear):** [ponder.kargain.com](https://ponder.kargain.com) indexes full commercial stacks on **84532** (hub `indexFromBlock` **44434865**) and **11155111** (Eth `indexFromBlock` **11319840`). **C3 dual-chain** adds `chainId` / `custodyChain` and chain-scoped verifier keys — **full reindex required** after deploy ([OPERATIONS.md](./OPERATIONS.md)).

## Contract addresses for indexer

Do **not** copy address tables here. Resolution is **per-chain** (SPEC §I.12.12):

**Addresses (per chainId, SPEC §I.12.12):**
- Committed: `lib/web3/commercial-active.ts` (`COMMERCIAL_ACTIVE`) — VPS / CI after `git pull`
- Optional local: `deployments/<chainId>.json` (gitignored deploy artifact; overrides when present)
- Optional debug (84532 only): `PONDER_*_ADDRESS` env
- Diagnostic: `pnpm ponder:config`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) + Eth nuclear table

**Start blocks:** `PONDER_START_BLOCK_84532=44434865` · `PONDER_START_BLOCK_11155111=11319840`. Per-contract start blocks from each manifest’s `blocks.*`.

## Dual-chain identity (C3 · July 2026)

| Field | Meaning |
|-------|---------|
| `passport.chainId` | Immutable origin (`tokenId >> 128`) |
| `passport.custodyChain` | Network where the usable instance lives |
| `consignment` / `challenge` / `passport_record` / `passport_uri_history` `chainId` | Network of the emitting event |
| `verifier.id` | `` `${chainId}-${address.toLowerCase()}` `` |

Browse: `GET /consignments?chainId=84532` (optional). Passport detail returns `records[]` / `uriHistory[]` with per-row `chainId` (UNION by global `tokenId`). Verifier detail: prefer `GET /verifiers/:address?chainId=84532`.

## Commerce modes API (FixedPrice / Ascending — July 2026)

Consignment commerce lives entirely in [`src/api/commerce-routes.ts`](../../src/api/commerce-routes.ts): **`GET /consignments*`** browse, **`GET /agents|owners/.../mandates`** portfolio, **`GET /challenges`** (BondedChallenge feed), and commerce claims. The legacy `MarketplaceEscrow` / `AuctionEscrow` schema and HTTP surface (`marketplace_listing`, `auction`, `GET /listings`, `GET /auctions*`, …) have been removed — there is no dual-write path.

**Production state (post step 5):** app and indexer code target consignment routes only, but **live mode addresses are absent** from `COMMERCIAL_ACTIVE` until **Nuclear #2** — production commerce stays **inert** (fail-closed) until then. Do **not** run a VPS reindex for step 5 alone; reindex triggers with Nuclear #2 step 10 ([OPERATIONS.md](./OPERATIONS.md)).

| Identity | Format |
|----------|--------|
| `consignment.id` | `` `${chainId}-${modeContract}-${tokenId}-${txHash}-${logIndex}` `` (append-only open) |
| `saleOrdinal` | 1-based count of opens for `(chainId, tokenId)` — UI only |
| `mandate.id` | `` `${chainId}-${modeContract}-${tokenId}` `` |
| `challenge.id` | `` `${chainId}-${instanceContract}-${subjectId}-${txHash}-${logIndex}` `` |
| `commerce_claim.id` | `` `${chainId}-${contract}-${account}-${asset}` `` (new surface; not `pending_claim`) |

| Route | Purpose |
|-------|---------|
| `GET /consignments` | Browse (`mode`, `active`, `seller`, `agent`, `chainId`) |
| `GET /consignments/by-token/:tokenId` | Passport commerce rail (live preferred, else latest historical) |
| `GET /consignments/:id` | Deep link by append-only id (“sale N”) |
| `GET /consignments/:id/bids` | Ascending bid history |
| `GET /agents/:address/mandates` | Agent portfolio (`?active=`) |
| `GET /owners/:address/mandates` | Owner delegated tab (`?active=`) |
| `GET /agents/:address/consignments` | Agent lots (`?awaiting=`, `?phase=`) |
| `GET /accounts/:address/claims` | Outstanding ClaimablePayouts balances (`amount > 0`); unions passport/staking `pending_claim` and mode `commerce_claim`; optional `?chainId=`; each claim includes `credits[]` (asc by timestamp: `id`, `amount`, `reasonCode`, `timestamp`); `{ claims, total, page, limit }` |
| `GET /commerce-claim-credits` | Whole-table commerce credit scan for local E2E (optional `?reasonCode=`) |
| `GET /challenges` | `BondedChallenge` feed shared by KarPassport disputes and `AscendingConsignment` — `?instance=passport\|ascending`, `?status=`, `?subjectId=`, `?challenger=`, `?chainId=`, `page`, `limit`; `instance=passport` rows include a denormalized `passport` object |
| `GET /commerce-modes` | Mode pause/guardian/rules projection (`?chainId=`, `?mode=fixedPrice\|ascending`, `?paused=`, `page`, `limit`) |
| `GET /commerce-payment-tokens` | Admitted payment tokens (`?chainId=`, `?modeContract=`, `?active=`, `page`, `limit`); soft-revoke → `active=false` |
| `GET /commerce-currency-feeds` | FixedPrice fiat currency → feed registry (`?chainId=`, `?modeContract=`, `?currencyCode=`, `page`, `limit`) |

Holds and ascending terms stay **embedded** in `GET /consignments/:id` (no standalone `/holds`). `vin_index` is an internal write-side index that drives product via `passport.duplicateVin` — not a missing HTTP surface.

## Verifier lifecycle (bounded indexing)

Ponder observes a **bounded event window** (start block, reindex checkpoints). KarProPass / KarProStaking handlers use [`src/lib/ponder-verifier-lifecycle.ts`](../../src/lib/ponder-verifier-lifecycle.ts): **creation** events (`ProPassMinted`, `VerifierJoined`) upsert `verifier` rows keyed by `` `${chainId}-${address}` ``; **mutation** and **deactivation** events patch only when a row exists — no row means the desired inactive/absent state already holds (idempotent no-op, not an error). KarPro Arweave metadata denorms `slug` plus Place fields (`locationLabel`, `locationPlaceId`, `locationCountryCode`) on mint/profile update (empty when incomplete or missing).

Passport rows include trust fields (`hadDispute`, `disputeOpenedAt`, `lastDisputeTerminal`, …) and nullable `disputeDeposit` (set on `ChallengeOpened` / legacy `DisputeDepositPaid`, cleared on challenge terminals). `lastDisputeTerminal` is `confirm` | `reject` | `expire` | `withdraw` | `""` — distinguishes expire-lapse from Confirm for product copy. Owner feed: `passport.dispute_expired` when terminal is expire; `passport.dispute_resolved` for confirm/reject. BondedChallenge `Challenge*` events also populate the shared `challenge` table — see `GET /challenges` above.

## HTTP API

Custom routes live in [`src/api/index.ts`](../../src/api/index.ts) (passport, verifier, notifications, claims union) and [`src/api/commerce-routes.ts`](../../src/api/commerce-routes.ts) (consignments, mandates, challenges, commerce config — see table above). Bigints are serialized as strings in JSON.

| Endpoint | Purpose |
|----------|---------|
| `GET /passports` | Browse/filter passports (`owner`, `verifier`, `status`, `vin`, `verifiedFirst`) |
| `GET /passports/:tokenId` | Passport detail + `records[]` + `uriHistory[]` |
| `GET /passports/batch` | Batch passport lookup (`?ids=`) |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /notifications/:address` | Notification feed, including active mandate grants (`mandate.granted`) |
| `GET /accounts/:address/claims` | Outstanding ClaimablePayouts balances (`amount > 0`); unions `pending_claim` + `commerce_claim`; optional `?chainId=`; each claim includes `credits[]` (asc by timestamp); `{ claims, total, page, limit }` |
| `GET /verifiers` | Verifier directory (`verificationFee` wei string; `locationLabel` / `locationPlaceId` / `locationCountryCode` from KarPro Arweave denorm) |
| `GET /verifiers/:address` | Verifier profile (`verificationFee` wei string; place fields on `identity`) |
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

## Local dev database (PGlite — no Docker)

Production and the VPS use **Postgres** (`DATABASE_URL` from docker-compose). Local dev and the E2E harness use **embedded PGlite** — no Docker required. [`scripts/lib/ponder-env.ts`](../../scripts/lib/ponder-env.ts) `resolvePonderDatabase()` chooses:

- **Postgres** when `DATABASE_URL` / `PONDER_DATABASE_URL` / `DATABASE_PRIVATE_URL` is set (production, always).
- **PGlite** (`.ponder/pglite`, override with `PONDER_PGLITE_DIR`) when `PONDER_ENABLE_LOCAL=1` and no connection string.

`./scripts/e2e-local.sh` leaves `DATABASE_URL` unset (PGlite) and sets `PONDER_LOCAL_ONLY=1` so Ponder indexes only the Hardhat chain and `/ready` does not wait on the public Base Sepolia RPC. These are **local-dev-only env guards** — production config is unchanged (Postgres, Base Sepolia).
