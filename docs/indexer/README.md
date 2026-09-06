# Ponder indexer documentation

| Document | Lifecycle | You need it when… |
|----------|-----------|-------------------|
| [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | **Reference** | v2 event/schema mapping, FX display extension (§6) |
| [ops/deploys/nuclear-7.md](../ops/deploys/nuclear-7.md) | **Current (S9-A)** | Nuclear #7 dual-chain — branch cutover; VPS reindex at Merge |
| [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md) | **Historical** | Nuclear #4 dual-chain (superseded by N7) |
| [ops/deploys/archive/84532-v2.md](../ops/deploys/archive/84532-v2.md) | **Historical** | June 2026 v2 deploy + VPS cutover record |

**Branch (Nuclear #7 / S9-B):** committed start blocks hub **46119704** / Eth **11591966** plus live Solana commercial namespace **2000040168**. **Browse Phase 1 live** 2026-08-14 ([OPERATIONS.md §6.0–§6.1](./OPERATIONS.md)): Vercel on `master` push; VPS reindex ASAP after schema. Smoke: `/read-path-ready`, `/consignments` (+ B1), payment-tokens, obligations, notifications. **S7b–c:** `bridge_crossing` + **`custody_determining_event`**; HTTP custody fold — **`custodyChain` | `custodyUnresolved`**. **S7c-1/2:** **`kargain_svm_raw`** + **`kargain_svm_projection`** — provenance UNION always includes SVM arm. Physical EVM columns **snake_case**. **S9-B:** `svm-ingest` startup now asserts RPC retention at the required cursor slot and reports first bootstrap separately from post-bootstrap lag incidents.

## SVM raw ingest (S7c-1)

Separate Node service — **not** inside the Ponder image. Append-only Postgres schema **`kargain_svm_raw`** (`structured_payload`, `ingest_refusal`, `ingest_cursor`). Sole INSERT owner: [`src/lib/svm-raw-writer.ts`](../../src/lib/svm-raw-writer.ts). Ponder reindex (`scripts/ponder-reindex.sql`) drops only `kargain` + `ponder_sync` — raw survives (policy: `test/ponder-reindex-svm-isolation-policy.test.ts`).

| Item | Value |
|------|--------|
| Health | `GET /live` (liveness) · `GET /ready` (readiness; 503 during bootstrap catch-up, startup retention refusal, or post-bootstrap catch-up incident) on **:42100** |
| Programs | Six production BPF slugs from S7a manifest (`kar-passport`, `kar-pro-staking`, `kar-pro-pass`, `kar-fixed-price`, `kar-ascending`, `kar-gateway`) — IDs from `deployments/svm-{eid}.json` |
| Start slot | `min(COMMERCIAL_ACTIVE.blocks.*)` over the six commercial programs on the Solana registry row |
| Ordering key | `(slot, tx_index_in_block, log_index)` — writer-local total order |
| Refusal kinds | `log_truncated` · `unknown_discriminator` · `payload_malformed` · `sequence_gap` |

**S7c-1 non-goals (historical):** projection lived in S7c-2; custody fold lived in S7c-3.

## SVM provenance projection (S7c-2)

Materialized schema **`kargain_svm_projection`** — tables `passport_record`, `passport_uri_history` (column shapes mirror Ponder). Sole writer: [`src/lib/svm-projection-writer.ts`](../../src/lib/svm-projection-writer.ts); inline projection on ingest + full rebuild via [`src/svm-ingest/projection-rebuild.ts`](../../src/svm-ingest/projection-rebuild.ts) (drop schema + replay from raw, no RPC).

| Item | Value |
|------|--------|
| Read owner | [`src/lib/ponder-passport-provenance.ts`](../../src/lib/ponder-passport-provenance.ts) — one `UNION ALL` SQL per call |
| Union routes | `GET /passports/:tokenId` (`records[]`, `uriHistory[]`); `GET /verifiers/:address/attestations`; notifications owned-passport record loop |
| Namespace filter | [`src/lib/ponder-read-namespaces.ts`](../../src/lib/ponder-read-namespaces.ts) `indexerReadNamespaceIds()` — commercial stacks plus localhost when `PONDER_ENABLE_LOCAL=1`. Query shape does **not** depend on adding or removing a Solana `COMMERCIAL_ACTIVE` row. |
| Replay proof | `pnpm svm-projection:replay-digest` (requires `SVM_INGEST_RPC_URL` unset) |

**S7c-2 non-goals:** no `passport` entity UNION; no custody fold; no production VPS action until **S9**.

## Contract addresses for indexer

Do **not** copy address tables here. Resolution is **per-chain** (SPEC §I.12.12):

**Addresses (per chainId, SPEC §I.12.12):**
- Committed: `lib/web3/commercial-active.ts` (`COMMERCIAL_ACTIVE`) — VPS / CI after `git pull`
- Optional local: `deployments/<chainId>.json` (gitignored deploy artifact; overrides when present)
- Optional debug (84532 only): `PONDER_*_ADDRESS` env
- Diagnostic: `pnpm ponder:config`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) + Eth nuclear table

**Start blocks:** `PONDER_START_BLOCK_84532=46119704` · `PONDER_START_BLOCK_11155111=11591966` (Nuclear #7 / S9-A). Per-contract start blocks from each manifest’s `blocks.*`.

## Dual-chain identity (C3 · July 2026)

| Field | Meaning |
|-------|---------|
| `passport.chainId` | Immutable origin (`tokenId >> 128`) |
| `custodyChain` / `custodyUnresolved` | **Read-time fold** (S7c-3) over `custody_determining_event` + `bridge_crossing`; resolved usable-copy namespace or named unresolved cause |
| `consignment` / `challenge` / `passport_record` / `passport_uri_history` `chainId` | Network of the emitting event |
| `verifier.id` | `` `${chainId}-${address.toLowerCase()}` `` |

Browse: `GET /consignments?chainId=84532` (optional). Passport detail returns `records[]` / `uriHistory[]` with per-row `chainId` (UNION by global `tokenId`). Verifier detail: prefer `GET /verifiers/:address?chainId=84532`.

## Commerce modes API (FixedPrice / Ascending — July 2026)

Consignment commerce lives entirely in [`src/api/commerce-routes.ts`](../../src/api/commerce-routes.ts): **`GET /consignments*`** browse, **`GET /agents|owners/.../mandates`** portfolio, **`GET /challenges`** (BondedChallenge feed), and commerce claims. The legacy `MarketplaceEscrow` / `AuctionEscrow` schema and HTTP surface (`marketplace_listing`, `auction`, `GET /listings`, `GET /auctions*`, …) have been removed — there is no dual-write path.

**Production state:** Live VPS until S9-A Merge remains Nuclear #4 (`44957457` / `11404204`). Branch / post-Merge: Nuclear #7 start blocks hub **46119704** / Eth **11591966**. Legacy `/listings` is gone.

| Identity | Format |
|----------|--------|
| `consignment.id` | `` `${chainId}-${modeContract}-${tokenId}-${txHash}-${logIndex}` `` (append-only open) |
| `saleOrdinal` | 1-based count of opens for `(chainId, tokenId)` — UI only |
| `mandate.id` | `` `${chainId}-${modeContract}-${tokenId}` `` |
| `challenge.id` | `` `${chainId}-${instanceContract}-${subjectId}-${txHash}-${logIndex}` `` |
| `commerce_claim.id` | `` `${chainId}-${contract}-${account}-${asset}` `` (new surface; not `pending_claim`) |

| Route | Purpose |
|-------|---------|
| `GET /consignments` | Browse with passport join filters/sort (`mode`, `active` = offered\|binding, `phase`, `seller`, `agent`, `chainId`, `page`, `limit`, plus search/make/model/year/mileage/price+FX/CSV vehicle attrs/placeId/colour/status/sort/verifiedFirst). Price/sort USD 1e8 = Asking facts (`listing-price-display`: fiat + USDC peg + native ETH). Envelope: `{ consignments, total, page, limit, statusCounts }`. `total` and `statusCounts` use the same predicates as the page. |
| `GET /consignments/by-token/:tokenId` | Passport commerce rail (live preferred, else latest historical); response `{ consignment }` |
| `GET /consignments/:id` | Deep link by append-only consignment id (**not** passport `tokenId`); response `{ consignment }` |
| `GET /consignments/:id/bids` | Ascending bid history for that consignment id |
| `GET /agents/:address/mandates` | Agent portfolio (`?active=`) |
| `GET /owners/:address/mandates` | Owner delegated tab (`?active=`) |
| `GET /agents/:address/consignments` | Agent lots (`?awaiting=`, `?phase=`) |
| `GET /accounts/:address/claims` | Outstanding ClaimablePayouts balances (`amount > 0`); unions passport/staking `pending_claim` and mode `commerce_claim`; optional `?chainId=`; each claim includes `credits[]` (asc by timestamp: `id`, `amount`, `reasonCode`, `timestamp`); `{ claims, total, page, limit }` |
| `GET /accounts/:address/obligations` | Facts bag for outstanding-obligation derivation (live consignments/holds/bids/challenges/passports/modes where the address is a party); union across commercial chains; optional `?chainId=`; `{ address, unresolved, consignments, holds, bids, challenges, passports, modes }` — clients call `deriveOutstandingObligations` (never invent outstanding locally) |
| `GET /commerce-claim-credits` | Whole-table commerce credit scan for local E2E (optional `?reasonCode=`) |
| `GET /challenges` | `BondedChallenge` feed shared by KarPassport disputes and `AscendingConsignment` — `?instance=passport\|ascending`, `?status=` (single or CSV `open,judged` for Needs action), `?subjectId=`, `?challenger=`, `?chainId=`, `page`, `limit`; `instance=passport` rows include a denormalized `passport` object. Browse chips own query via `lib/challenge/browse-filters.ts`. |
| `GET /commerce-modes` | Mode pause/guardian/rules projection (`?chainId=`, `?mode=fixedPrice\|ascending`, `?paused=`, `page`, `limit`). FixedPrice rows expose `nativeUsdStalenessTolerance` (seconds). Ascending rows expose `minProtectionWindow` / `maxProtectionWindow` (opener bounds — **not** the lot hold length; lot hold is `ascending_terms.protectionWindow` on the consignment). |
| `GET /commerce-payment-tokens` | Admitted payment tokens (`?chainId=`, `?modeContract=`, `?active=`, `page`, `limit`); soft-revoke → `active=false`; FixedPrice rows include `feed` + `stalenessTolerance` (0 when feed empty) |
| `GET /commerce-currency-feeds` | FixedPrice fiat currency → feed registry (`?chainId=`, `?modeContract=`, `?currencyCode=`, `page`, `limit`); each row includes `stalenessTolerance` (0 when feed cleared) |

Holds and ascending terms stay **embedded** in `GET /consignments/:id` (no standalone `/holds`). `vin_index` is an internal write-side index that drives product via `passport.duplicateVin` — not a missing HTTP surface.

**Not registered (do not call):** `GET /consignments/stats`, `GET /consignments/facets`, legacy `GET /listings*`, `GET /auctions*`. Ambient marketplace counts use browse `total` + `statusCounts.VERIFIED` (`limit=1`) plus auction/verifier counts — not a stats route.

## Verifier lifecycle (bounded indexing)

Ponder observes a **bounded event window** (start block, reindex checkpoints). KarProPass / KarProStaking handlers use [`src/lib/ponder-verifier-lifecycle.ts`](../../src/lib/ponder-verifier-lifecycle.ts): **creation** events (`ProPassMinted`, `VerifierJoined`) upsert `verifier` rows keyed by `` `${chainId}-${address}` ``; **mutation** and **deactivation** events patch only when a row exists — no row means the desired inactive/absent state already holds (idempotent no-op, not an error). KarPro Arweave metadata denorms `slug` plus Place fields (`locationLabel`, `locationPlaceId`, `locationCountryCode`) on mint/profile update (empty when incomplete or missing).

Passport rows include trust fields (`hadDispute`, `disputeOpenedAt`, `lastDisputeTerminal`, …) and nullable `disputeDeposit` (set on `ChallengeOpened` / legacy `DisputeDepositPaid`, cleared on challenge terminals). `lastDisputeTerminal` is `confirm` | `reject` | `expire` | `withdraw` | `""` — distinguishes expire-lapse from Confirm for product copy. Owner feed: `passport.dispute_expired` when terminal is expire; `passport.dispute_resolved` for confirm/reject. BondedChallenge `Challenge*` events also populate the shared `challenge` table — see `GET /challenges` above.

## HTTP API

Custom routes live in [`src/api/index.ts`](../../src/api/index.ts) (passport, verifier, notifications, claims union) and [`src/api/commerce-routes.ts`](../../src/api/commerce-routes.ts) (consignments, mandates, challenges, commerce config — see table above). Bigints are serialized as strings in JSON.

**App reads:** product code builds Ponder URLs and tagged reads only through [`lib/web3/ponder-fetch.ts`](../../lib/web3/ponder-fetch.ts) (`ponderFetch(tag, url)` → `"use cache"` + `cacheTag`; tags = `INDEXER_QUERY_KEY_PREFIXES`). Invalidation: `syncReads` → `updateTag`. Do not hand-build `${PONDER_SQL_API_URL}/…` paths in actions/lib.

**Response cache headers (indexer → edge):** one middleware on the Hono `app` ([`ponder-http-cache-middleware.ts`](../../src/lib/ponder-http-cache-middleware.ts)) sets `Cache-Control` + weak `ETag` and answers `If-None-Match` with **304**. Freshness class per route is data in [`ponder-http-freshness.ts`](../../src/lib/ponder-http-freshness.ts) (`config` / `catalog` / `entity` / `account` / `ephemeral` — **not** Truth layers T1–T6). Protocol projections keep **zero** edge TTL; Cloudflare may enable only `ephemeral` + `config` ([OPERATIONS.md §6.2](./OPERATIONS.md)). No CF purge from user txs. A Hono route without a class fails closed (500 + `private, no-store`); coverage: `test/ponder-http-freshness-policy.test.ts`.

| Endpoint | Purpose |
|----------|---------|
| `GET /read-path-ready` | Custom read-path readiness. Returns **200** when the API can execute the same empty-arm EVM+SVM `UNION ALL` forms as product reads, **503** with named `missingRelations[]` when required relations like `kargain_svm_projection.*` are absent. This is **not** Ponder sync state. |
| `GET /passports` | Browse/filter passports (`owner`, `verifier`, `status`, `vin`, `verifiedFirst`) |
| `GET /passports/:tokenId` | Passport detail + `records[]` + `uriHistory[]` (**provenance UNION** across EVM Ponder + SVM projection by global `tokenId`; per-row `chainId` = emitting network) |
| `GET /passports/batch` | Batch passport lookup (`?ids=`) |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /notifications/:address` | Notification feed: passport/mandate/claims + commerce lifecycle (`commerce.*`) + approaching deadlines from obligation derivation; `claim.recorded` unions `claim_credit` + `commerce_claim_credit` |
| `GET /accounts/:address/claims` | Outstanding ClaimablePayouts balances (`amount > 0`); unions `pending_claim` + `commerce_claim`; optional `?chainId=`; each claim includes `credits[]` (asc by timestamp); `{ claims, total, page, limit }` |
| `GET /accounts/:address/obligations` | Address-centric commerce facts bag for Outstanding panel + approaching feed (see commerce table above) |
| `GET /verifiers` | Verifier directory (`verificationFee` wei string; `locationLabel` / `locationPlaceId` / `locationCountryCode` from KarPro Arweave denorm; each row includes `chainId`) |
| `GET /verifiers/:address` | Verifier profile (`verificationFee` wei string; place fields on `identity`). **Prefer `?chainId=`** (SPEC §I.12.12). Without `chainId`, first active row for the address (case-insensitive match on stored `address`) |
| `GET /verifiers/by-slug/:slug` | Resolve slug → address (optional `?chainId=`) |
| `GET /verifiers/:address/attestations` | Verifier attestations |

### Ponder reserved routes

Do **not** define these in `src/api/index.ts` — Ponder owns them ([docs](https://ponder.sh/docs/api-reference/ponder/api-endpoints)):

| Route | Purpose |
|-------|---------|
| `GET /health` | Liveness — HTTP 200 when the process is up (may have empty body) |
| `GET /ready` | Readiness — HTTP 503 during backfill, 200 when caught up |
| `GET /status` | Indexing sync status |

`GET /read-path-ready` is **not** reserved: it is Kargain's own route in `src/api/index.ts`, and it complements `/ready` by checking read-path executability rather than indexer sync state.

Smoke checks after reindex: [OPERATIONS.md §6](./OPERATIONS.md#6-smoke-checks).

## Local dev database (PGlite — no Docker)

Production and the VPS use **Postgres** (`DATABASE_URL` from docker-compose). Local dev and the E2E harness use **embedded PGlite** — no Docker required. [`scripts/lib/ponder-env.ts`](../../scripts/lib/ponder-env.ts) `resolvePonderDatabase()` chooses:

- **Postgres** when `DATABASE_URL` / `PONDER_DATABASE_URL` / `DATABASE_PRIVATE_URL` is set (production, always).
- **PGlite** (`.ponder/pglite`, override with `PONDER_PGLITE_DIR`) when `PONDER_ENABLE_LOCAL=1` and no connection string.

`./scripts/e2e-local.sh` leaves `DATABASE_URL` unset (PGlite) and sets `PONDER_LOCAL_ONLY=1` so Ponder indexes only the Hardhat chain and `/ready` does not wait on the public Base Sepolia RPC. These are **local-dev-only env guards** — production config is unchanged (Postgres, Base Sepolia).
