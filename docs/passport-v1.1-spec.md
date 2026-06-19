# KarPassport v1.1 — Product & Contract Spec

Status: **complete** (Phases 1–5 + polish PR5a–d + Irys upload hardening + passport detail UX + notifications/watchlist, `master` June 2026)  
Branch: merged via PR #1 (`feat/passport-v1.1`) + follow-up polish on `master`  
Base deploy: Base Sepolia Model X v1.1 (June 2026) — redeploy + Basescan verify complete  

> **Multi-chain product:** Kargain is designed as a **multi-chain platform**. Base Sepolia is the current **test deployment** only. Contract logic, env configuration (`*_BY_CHAIN`), and UI chain selection must not assume a single network permanently. See [README.md](../README.md) § Multi-chain platform.

## 1. Philosophy

- **Multi-chain** — Kargain is a multi-chain platform. Base Sepolia is the integration testnet for v1.1; the same Model X stack redeploys per network. Off-chain metadata (Arweave) and messaging (XMTP) stay chain-agnostic; trust state and listings are chain-scoped.
- **Passport** = hybrid public fact registry + transferable ownership. **No burn.**
- **Trust state** (`status`, `verifier`, `verifiedAt`) — **on-chain only**.
- **Vehicle description** — extensible metadata JSON on Arweave (`tokenURI` pointer).
- **History** — append-only on-chain `records[]`.
- **Spam / trust** — transparency + UI curation, not on-chain gates (no mint fee, no listing stake in v1.1).

## 2. Status lifecycle

```
UNVERIFIED ──verifyPassport──► VERIFIED
     ▲                              │
     │                              │ disputePassport (anyone)
     │                              ▼
     │                          DISPUTED
     │                              │
     │              resolveDispute(uphold=true)  ──► VERIFIED
     │              resolveDispute(uphold=false) ──► UNVERIFIED
     │
     └── setPassportURI from VERIFIED ── VerificationReset ──► UNVERIFIED
```

**Exit from DISPUTED:** only `resolveDispute` (active verifier). Owner cannot edit metadata while DISPUTED.

## 3. `setPassportURI` (Variant C — Phase 1)

| Current status | New URI | Result |
|----------------|---------|--------|
| UNVERIFIED | different | Update URI, no reset |
| UNVERIFIED | same | `revert SameURI()` |
| VERIFIED | different | `VerificationReset` → UNVERIFIED, update URI |
| VERIFIED | same | `revert SameURI()` (verification preserved) |
| DISPUTED | any | `revert InvalidStatus(DISPUTED)` |
| Listed (escrow owns NFT) | any | `revert NotOwner()` |

**Validation order:**

1. `_requireExists`
2. `NotOwner`
3. `EmptyField("uri")` if `newURI` empty
4. `InvalidStatus` if DISPUTED
5. `SameURI` if `keccak256(newURI) == keccak256(tokenURI(tokenId))`
6. If VERIFIED → reset status, verifier, verifiedAt; emit `VerificationReset`
7. `_setTokenURI` + `PassportURIUpdated`

**Artifacts:**

- `event VerificationReset(uint256 indexed tokenId, address indexed author)`
- `error SameURI()`

## 4. Metadata vs records

| Layer | Contents | Resets verification? |
|-------|----------|----------------------|
| Metadata JSON | VIN, make, model, year, mileage, photos, type, colour, location, … | **Only** via `setPassportURI` from VERIFIED |
| `appendRecord` | service, clarifications, sale notes | **Never** |
| `reportDiscrepancy` | light discrepancy signal | **Never** |
| `disputePassport` | opens DISPUTED + discrepancy record | N/A (status → DISPUTED) |
| `appendAttestation` | verifier attestation | **Never** |

**Canonical for buyer:** current metadata + full record timeline.

**VIN:** field in JSON only; duplicates allowed on-chain; Ponder/UI warn (Phase 3).

## 5. Dispute model

### On-chain

- `disputePassport` — heavy (VERIFIED → DISPUTED). Permissionless including self-dispute.
- `reportDiscrepancy` — light (record only, status unchanged).
- **Any active verifier** resolves DISPUTED via `resolveDispute(uphold)` (not limited to the verifier who originally verified the passport).

### D6 — Dispute withdraw (A+ convention, no extra contract fn)

Disputer withdraws **signal only**; status stays DISPUTED until verifier resolves.

1. Disputer calls `reportDiscrepancy(tokenId, "[dispute-withdrawn] <note>", evidenceCID)`.
2. Ponder/UI: if `author == lastDisputer` and description has prefix `[dispute-withdrawn]` → flag `disputeWithdrawnAt` (Phase 3).
3. UI label: **Dispute withdrawn** (derived; on-chain `recordType` remains `"discrepancy"`).

### Owner during DISPUTED

- `appendRecord` for clarifications (`dispute-clarification`) when owner holds NFT.
- **Not possible while listed** (escrow = owner).

### After `resolve(false)` → UNVERIFIED

Owner may `setPassportURI`, then request re-verification.

## 6. Marketplace (unchanged in Phase 1)

- List UNVERIFIED / VERIFIED / DISPUTED — allowed on-chain.
- Escrow does not read passport status.
- UI: verified-first browse, risk modals (Phase 3); no on-chain buy block in v1.1.

## 7. Transfer

- Buyer inherits `passportStatus[tokenId]` — no auto-reset on sale (E5).

## 8. Redeploy scope (Phase 5 — not Phase 1)

| Contract | Change |
|----------|--------|
| KarPassport | new impl (this spec) |
| MarketplaceEscrow | new proxy (immutable `karPassport` address) |
| KarProPass / KarProStaking | unchanged |

## 9. Phase map

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **1** | Spec + `setPassportURI` + tests (no deploy) | **✅ Done** |
| **2** | Metadata schema v1.1 shared modules | **✅ Done** |
| **3** | Ponder schema, uri_history, trust flags, UI blocks | **✅ Done** |
| **4** | Localhost 31337 E2E | **✅ Done** |
| **5** | Single Sepolia redeploy + reindex + merge to master | **✅ Done** |
| **5 polish** | Record labels, attestation UI, browse chain warning, Basescan verify | **✅ Done** |
| **UI complete (June 2026)** | All contract + Ponder UI coverage; filters, shell, KarPro, showrooms | **✅ Done** |
| **Irys upload hardening (June 2026)** | Batch upload, chain gateway, smart-wallet block, create/edit parity | **✅ Done** |

## 10. Phase 1 test matrix

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | UNVERIFIED, new URI | OK, no VerificationReset |
| T2 | UNVERIFIED, same URI | revert SameURI |
| T3 | VERIFIED, new URI | UNVERIFIED + VerificationReset |
| T4 | VERIFIED, same URI | revert SameURI, stay VERIFIED |
| T5 | DISPUTED, any URI | revert InvalidStatus |
| T6 | empty URI | revert EmptyField |
| T7 | not owner | revert NotOwner |
| T8 | listed (escrow owner) | revert NotOwner |
| T9 | resolve(false) then edit | OK |
| T10 | appendRecord on VERIFIED | status unchanged |

## 11. Metadata JSON v1.1 wire schema (Phase 2)

**Write path (create / edit upload):** always emit `version: "1.1"` with **camelCase** keys.

### Required / core fields

| Field | Type | Notes |
|-------|------|-------|
| `version` | `"1.1"` | Wire version for new uploads |
| `name` | string | Display title, e.g. `"2021 Honda Civic"` |
| `vin` | string | Normalized uppercase, 11–17 chars |
| `make`, `model` | string | Required |
| `year` | number | Integer |
| `mileageKm` | number | Non-negative; `0` if omitted in form |
| `photos` | string[] | Arweave URIs (`ar://…`); min 1 on create |
| `createdAt`, `updatedAt` | string | ISO-8601 timestamps |

### Optional v1.1 fields

Omit empty keys from JSON. Supported optional fields: `description`, `modelVariant`, `type`, `vehicleType`, `fuelType`, `bodyType`, `transmission`, `power`, `evBatteryKwh`, `colour`, `location` (`{ label?, lat?, lng? }`), `engine`, `features` (string[]), `condition`.

### Legacy v1.0 read compatibility

Existing on-chain passports (e.g. Sepolia #0) may use:

- `version: "1.0"`
- `mileage_km` instead of `mileageKm`
- snake_case legacy keys: `fuel_type`, `body_type`, `color`, `created_at`
- Parser normalizes to app type `PassportMetadata` (camelCase) and preserves `version: "1.0" | "1.1"`.

### PII (J1)

Wire JSON must **not** include `ownerName`, `phone`, or `email`. Build path rejects these keys before upload.

### Anchor vs cosmetic diff (Phase 3 prep)

`diffPassportMetadata` classifies changes for edit confirmation:

- **Anchor:** `vin`, `make`, `model`, `year`, `type`, `photos`, and `mileageKm` when delta > **500 km**
- **Cosmetic:** description, colour, power, and other optional fields; small mileage updates (≤ 500 km)

### Shared modules

| Module | Role |
|--------|------|
| `lib/passport/metadata-constants.ts` | Version, limits, anchor/PII keys |
| `lib/passport/metadata-schema.ts` | Zod schema, form validation, `normalizeVin` |
| `lib/passport/build-metadata-json.ts` | `buildMetadataWire` → v1.1 JSON |
| `lib/passport/parse-metadata-json.ts` | `parseMetadataJson` (v1.0 + v1.1) |
| `lib/passport/metadata-diff.ts` | Anchor/cosmetic diff for edit UI |
| `lib/passport/fetch-arweave-metadata.ts` | HTTP fetch + parse |
| `lib/passport/record-types.ts` | On-chain record → UI labels (PR5a) |
| `lib/passport/confirm-listing-status.ts` | Ponder vs chain status drift (PR5c) |
| `lib/passport/upload-passport-metadata.ts` | `uploadPassportToIrys`, wallet check, batch photos, metadata JSON |
| `lib/passport/upload-evidence.ts` | Irys upload for attestation evidence (PR5b) |
| `lib/storage/irys-client.ts` | `@irys/web-upload` — fund, batch folder, chain-aware bundler |
| `lib/storage/ar-gateway.ts` | Chain-aware `ar://` → HTTP gateway (devnet vs mainnet) |

Run metadata unit tests: `pnpm test:metadata` · records: `pnpm test:records` · browse drift: `pnpm test:confirm-status`.

## 12. Phase 3 checklist (Ponder + UI)

### Ponder

- [x] `passport_uri_history` table + `vin_index`
- [x] Extended `passport` trust/VIN denorm fields
- [x] G1 trust fields: `lastMetadataChangeAt`, `verificationResetCount`, `hadDispute`, `lastDisputeResolvedAt`
- [x] `VerificationReset` handler
- [x] D6 `disputeWithdrawnAt` on `RecordAppended`
- [x] Metadata indexer on mint/URI update (Arweave fetch + `parseMetadataJson`)
- [x] REST: passport detail with `uriHistory`, listings join + facets

### UI blocks

- [x] Passport actions (verify / dispute / resolve / withdraw / report / **attestation**)
- [x] Edit passport wizard + anchor/cosmetic confirm modal
- [x] URI history timeline
- [x] **Typed records timeline** — labels, severity, owner-initiated dispute, withdrawn signal (PR5a / D1, D5)
- [x] DISPUTED sidebar from Ponder `disputeReason` + `lastDisputer` (not record scan)
- [x] **Verifier attestation** form with optional evidence upload (PR5b / B2)
- [x] Marketplace list / delist / buy wiring
- [x] Browse verified-first + status badges / duplicate VIN warnings
- [x] **Browse chain-status sample** — up to 12 cards confirm `getPassportStatus` vs Ponder (PR5c / G4)
- [x] **E4** BuyRiskModal — explicit risk ack before `buyWithNative`
- [x] **G2** post-dispute re-verify banner on passport detail
- [x] Verifier metadata diff + re-inspection hint (C2/C3)
- [x] DISPUTED browse filter
- [x] Profile page data from Ponder (listings enriched)
- [x] Kar Pro join/leave staking
- [x] Verifier detail page (`/verifier/[address]`) + inactive verifier badge (C5)

Run handler unit tests: `pnpm test:ponder` (`test/ponder-indexer.test.ts`).

## 13. Local E2E (Phase 4)

Local dev stack on **Hardhat chain 31337** — full passport lifecycle + optional Ponder API checks before Phase 5 Sepolia redeploy.

### Dev stack

| Component | Command / artifact |
|-----------|-------------------|
| Hardhat node | `npx hardhat node` (:8545) |
| Deploy Model X | `pnpm deploy:local` → `deployments/31337.json` |
| Ponder (local chain) | `PONDER_ENABLE_LOCAL=1 pnpm ponder:dev` |
| Orchestration | `./scripts/dev-local.sh` |
| One-shot E2E | `./scripts/e2e-local.sh` |

### Env vars (local)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=1` | Add chain 31337 to wagmi |
| `NEXT_PUBLIC_CHAIN_ID=31337` | Default UI chain |
| `NEXT_PUBLIC_RPC_BY_CHAIN` | Include `"31337":"http://127.0.0.1:8545"` |
| `PONDER_ENABLE_LOCAL=1` | Index localhost in `ponder.config.ts` |
| `PONDER_RPC_URL_31337` | Hardhat RPC for Ponder |
| `PONDER_START_BLOCK=0` | Full replay from local deploy |

Export addresses after deploy: `eval "$(node --import tsx scripts/lib/print-local-env.ts)"`

### E2E scenario (`pnpm test:e2e`)

Requires running Hardhat node + `pnpm deploy:local` (or use `./scripts/e2e-local.sh`).

| Step | Action | Assert |
|------|--------|--------|
| 1 | `becomeVerifierNative` | verifier active |
| 2 | `mintPassport` | UNVERIFIED, tokenId 0 |
| 3 | `verifyPassport` | VERIFIED |
| 4 | `setPassportURI` | `VerificationReset`, UNVERIFIED |
| 5 | `verifyPassport` | VERIFIED |
| 6 | `disputePassport` | DISPUTED |
| 7 | `resolveDispute(false)` | UNVERIFIED |
| 8 | `setPassportURI` | OK (T9) |
| 9 | re-verify, `list` + `buyWithNative` | buyer owns NFT, listing inactive |
| 10 | `appendRecord` on VERIFIED | status unchanged (T10) |

**Ponder (optional):** poll `GET /passports/0` for `uriHistory` with `verificationReset: true`. Skipped when `PONDER_SQL_API_URL` unreachable.

Run: `pnpm test:e2e` (sets `KARGAIN_E2E_LOCAL=1`) · `pnpm typecheck` · `pnpm hardhat test`

**Note:** `localhost` Hardhat network uses the node's default funded accounts, not `DEPLOYER_PRIVATE_KEY`.

## 14. Phase 5 redeploy (Base Sepolia v1.1)

**Scope (partial):** new `KarPassport` + `MarketplaceEscrow` impl/proxy; **unchanged** `KarProPass` + `KarProStaking`.

| Contract | Address |
|----------|---------|
| KarProPass | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` |
| KarProStaking | `0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31` |
| KarPassport v1.1 | `0x6378469256907D7DC14BBfce0261ceDE22314507` |
| MarketplaceEscrow impl | `0x7d37e7cbcc42308264B608429a82D03B7C3112F4` |
| MarketplaceEscrow proxy | `0x4FC74e0B7eE0A741707A553D43Efff68126D198B` |

Deploy: `pnpm deploy:v1.1` → writes `deployments/84532.json` (gitignored manifest with per-contract blocks + `indexFromBlock`).

**Basescan verify (one-time ops):**

```bash
# Requires ETHERSCAN_API_KEY (Etherscan v2, chainid=84532) in .env.local
pnpm verify:v1.1
```

Verifies, in order: KarPassport, MarketplaceEscrow impl, ERC1967 proxy (with `initialize` calldata). Skips contracts already verified; pass `--force` to re-submit. Loads `ETHERSCAN_API_KEY` from `.env.local` / `.env`. Does **not** run on VPS — use a machine with the API key only.

**Status (June 2026):** KarPassport, MarketplaceEscrow impl, and proxy verified on [Base Sepolia Basescan](https://sepolia.basescan.org).

| Contract | Basescan |
|----------|----------|
| KarPassport v1.1 | https://sepolia.basescan.org/address/0x6378469256907D7DC14BBfce0261ceDE22314507 |
| MarketplaceEscrow impl | https://sepolia.basescan.org/address/0x7d37e7cbcc42308264B608429a82D03B7C3112F4 |
| MarketplaceEscrow proxy | https://sepolia.basescan.org/address/0x4FC74e0B7eE0A741707A553D43Efff68126D198B |

Run constructor-arg unit tests: `pnpm test:verify`.

### Ponder indexing (env-driven, no ponder.config.ts edits on deploy)

| Variable | Purpose |
|----------|---------|
| `PONDER_START_BLOCK_84532` | `latest` (prod) or `indexFromBlock` (one-time backfill) |
| `PONDER_START_BLOCK_31337` | `0` for local Hardhat |
| `PONDER_*_ADDRESS` | Override manifest addresses on VPS |

Generate VPS env: `node --import tsx scripts/lib/print-ponder-env.ts`

### VPS reindex runbook

**Trigger:** any change to `ponder.schema.ts` or new indexed event handlers that alter row shape — deploy code, then reindex before relying on new fields in production.

```bash
docker compose stop ponder
psql "$DATABASE_URL" -f scripts/ponder-reindex.sql
eval "$(node --import tsx scripts/lib/print-ponder-env.ts)"   # paste into .env
# Use Alchemy/QuickNode for PONDER_RPC_URL_84532 during backfill
docker compose up -d ponder
# After sync: PONDER_START_BLOCK_84532=latest
```

Local check after schema change: `PONDER_ENABLE_LOCAL=1 pnpm ponder:dev` from block `0`, or run `pnpm test:ponder` for G1 handler unit tests.

**Full runbook:** [docs/VPS-PONDER-REINDEX.md](./VPS-PONDER-REINDEX.md)

Resolver: `scripts/lib/ponder-env.ts` · Per-contract start blocks from manifest when backfilling.

**Document map:** Public status lives in this spec (§17 UI complete · §19 passport detail UX · §20 notifications + watchlist) and [README.md](../README.md). Local-only (gitignored): `docs/HANDOFF.md`, `docs/SESSION.md`, `docs/REFERENCE.md`, `docs/ROADMAP.md`, `docs/design-spec.md` — sync manually after major milestones.

## 15. Plan A–J core — definition of done (June 2026)

| Criterion | Status |
|-----------|--------|
| E4 — buy without risk ack blocked | ✅ |
| C5 — inactive verifier visible | ✅ |
| C2/C3 — verifier diff + re-inspect hint | ✅ |
| G1/G2 — Ponder fields + detail banner | ✅ (code + VPS reindex June 2026) |
| DISPUTED browse filter | ✅ |
| README Variant C truth | ✅ |
| No dead stubs; types synced | ✅ |
| T10 / E5 contract tests | ✅ |
| Resolve gating = contract (any active verifier) | ✅ documented §5 |

Contract tests: `pnpm hardhat test` (T10, E5, listed `appendRecord` NotOwner) · Ponder: `pnpm test:ponder` · trust: `pnpm test:trust`

## 16. Phase 5 polish — definition of done (June 2026)

| Criterion | PR | Status |
|-----------|-----|--------|
| Typed record labels in timeline (not raw `recordType`) | 5a | ✅ |
| DISPUTED banner from Ponder fields, not record scan | 5a | ✅ |
| Owner-initiated dispute label | 5a | ✅ |
| Verifier attestation UI (`appendAttestation` + evidence) | 5b | ✅ |
| Browse status drift warning (sample chain confirm) | 5c | ✅ |
| v1.1 contracts verified on Basescan | 5d | ✅ |

**Tests:** `pnpm test:records` · `pnpm test:confirm-status` · `pnpm test:verify` · `pnpm verify:v1.1` (ops, needs API key)

**Deferred (Phase 6+):** evidence upload on report/clarification, owner service-history UI, full browse batch confirm, trust API endpoint, `buyWithUsdc` UI.

## 17. UI complete — definition of done (June 2026)

**Status:** All contract functions have UI coverage. All Ponder API endpoints have UI consumers.

| Area | Route / component | Status |
|------|-------------------|--------|
| Marketplace browse + filters | `/` · `market-filter-bar` / drawer / chips | ✅ |
| Mint + photo upload | `/passport/new` · `photo-upload-zone` | ✅ |
| Edit (Variant C) | `/passport/[tokenId]/edit` | ✅ |
| Verify / dispute / resolve / attestation | `passport-actions-panel` | ✅ |
| Marketplace detail + trust | `/marketplace/[tokenId]` · `passport-detail-view`, `PassportTrustBanner`, `PassportUriHistory` | ✅ (§19 polish June 2026) |
| KarPro onboarding | `/kar-pro` | ✅ |
| Verifier directory | `/verifiers` | ✅ |
| Verifier profile | `/verifier/[address]` | ✅ |
| Pro showroom | `/pro/[slug]` · `PRO_SLUGS` (empty until owner adds slug) | ✅ |
| Profile + showroom link | `/profile/[handle]` · `proSlugForAddress()` | ✅ |
| Messages (XMTP) | `/messages` | ✅ |
| Notifications | `/notifications` · `notifications-shell` (Alerts + Watchlist tabs) | ✅ |
| ENS on addresses | wallet dropdown + profile displays | ✅ |
| Mobile shell | 5-tab bottom nav; KarPro in top nav when eligible; no top/bottom duplication | ✅ |
| KarPro credential | `proSlugForAddress()` showroom link (not `PRO_SLUGS[address]`) | ✅ |

**Ponder → UI:** Full endpoint consumer map in [README.md](../README.md) § Ponder API.

**Ops next steps:**

1. Ponder reindex — `disputeOpenedAt` + filter schema columns on `passport` ([VPS-PONDER-REINDEX.md](./VPS-PONDER-REINDEX.md))
2. Stake on `/kar-pro` and add slug to `lib/web3/pro-slugs.ts`
3. Sepolia smoke validation — [README.md](../README.md) checklist

**Tech debt (documented):** desktop filter bar `overflow-hidden` ~768px; Ponder reindex pending for `disputeOpenedAt` + filter facets; notifications Phase 2 (`ownedTokenIds`, feed N+1, tx grouping); `upgradeAuthority` = deployer EOA; stale `deploy-proxy.ts`; smart wallets cannot fund Irys client-side (EOA required for upload).

## 18. Irys / Arweave upload — definition of done (June 2026)

**Status:** Client-side user-pays upload is production-ready on Base Sepolia for **EOA wallets**. Create and edit wizards share one code path.

### Architecture (chain-agnostic metadata, chain-aware Irys node + gateway)

| Layer | Behavior |
|-------|----------|
| **On-chain** | `tokenURI` = `ar://{txId}` — same URI format on every chain |
| **Upload payment** | User wallet funds Irys balance on the **connected chain** (84532 devnet today; 8453/1 mainnet nodes when live) |
| **Photo batch** | `uploadFolder` — one signature for N photos |
| **Metadata** | Same Irys session as photos; `ensureFunded` for JSON size |
| **HTTP display** | `resolveUri(uri, chainId)` — testnet chains → `gateway.irys.xyz`; mainnet chains → `arweave.net` |

### Shared modules

| Module | Role |
|--------|------|
| `lib/passport/upload-passport-metadata.ts` | `uploadPassportToIrys`, `checkWalletForIrysUpload`, `formatPassportUploadError`, `PassportIrysWalletBlockedError` |
| `lib/storage/irys-client.ts` | `checkIrysCompatibility`, `prepareUserPaidUpload`, `uploadFilesWithUploader`, bundler URL from wallet `chainId` |
| `lib/storage/ar-gateway.ts` | `arweaveGateway(chainId)`, `arUriToHttp` |
| `components/passport/passport-upload-progress.tsx` | Shared progress UI (create + edit) |
| `components/passport/create-passport-wizard.tsx` | Mint flow → `uploadPassportToIrys` → `mintPassport` |
| `components/passport/edit-passport-wizard.tsx` | Edit flow → `uploadPassportToIrys` (interleaved existing/new photos) → `setPassportURI` |

### Wallet compatibility

| Account type | `eth_getCode` | Upload |
|--------------|---------------|--------|
| EOA | `0x` / `0x0` | ✅ Allowed |
| EIP-7702 smart EOA | `0xef0100…` | ❌ Blocked before `fund()` — user message with EOA instructions |
| Contract / ERC-4337 | other bytecode | ❌ Blocked before `fund()` |
| RPC detection failure | — | Fail-open; Irys error surfaced via `formatPassportUploadError` |

Pre-check runs on **every** save (including metadata-only edits) because metadata JSON upload may call `fund()`.

### Commits (June 2026, `master`)

| Commit | Summary |
|--------|---------|
| `a5b9895` | Batch photos via `uploadFolder` |
| `add8818` | Chain-aware `ar://` gateway (devnet → `gateway.irys.xyz`) |
| `03a177b` | Remove IPFS from env/code |
| `d26ede0` | Smart-account detection + unified error handling |
| `c377776` | `uploadPassportToIrys` + edit/create parity + unit tests |

### Tests

| File | Coverage |
|------|----------|
| `test/irys-compatibility.test.ts` | `checkIrysCompatibility`, `checkWalletForIrysUpload`, fail-open |
| `test/passport-upload.test.ts` | `uploadPassportToIrys` wallet block, `formatPassportUploadError` |
| `test/ar-gateway.test.ts` | Gateway selection by chain ID |

Run: `node --import tsx --test test/*.test.ts`

### Multichain checklist (when adding a chain)

1. Deploy Model X contracts → `deployments/{chainId}.json`
2. Add chain to `lib/web3/supported-chains.ts` and `deployment-addresses.ts`
3. Extend `BASE_CHAIN_IDS` in `irys-client.ts` if Irys supports that chain’s payment token
4. Extend `MAINNET_CHAIN_IDS` in `ar-gateway.ts` if chain uses `arweave.net` gateway
5. Add Ponder RPC + contract addresses for the chain
6. Smoke: mint + edit passport with EOA on the new network

### Deferred

- **Browser E2E** (Playwright + mock `eth_getCode`) — separate QA task; unit tests sufficient for merge
- **Smart-wallet storage** — product decision: keep EOA requirement vs server-side upload vs alternative storage
- **Attestation evidence** — still uses separate `upload-evidence.ts` path (same Irys client)

## 19. Passport detail page UX — definition of done (June 2026)

**Status:** Passport/marketplace detail restructured for identity-first mobile layout, hardened Nostr identity, role-based actions, trust banners, canonical address formatting, and guest-readable discussion.

### Nostr identity hardening

| Change | Detail |
|--------|--------|
| UI removed | `exportNsec` / `importNsec` — no user-facing key export/import |
| Dead code | `exportNsec` / `importNsec` removed from `lib/nostr/key-manager.ts` |
| `originTag()` | Removed from key derivation and AES encryption |
| Canonical message | `kargain-nostr-v1:${address.toLowerCase()}` |
| Canonical AES key | `kargain-aes-v1:${address.toLowerCase()}` |
| Init | Nostr identity initializes automatically on wallet connect |

### `passport-detail-view.tsx` layout

| Zone | Behavior |
|------|----------|
| **Zone A (identity header)** | Title + status + owner — always first |
| **Mobile** | Identity visible before photo gallery |
| **Verifier block** | Main column (unique info, not duplicated elsewhere) |
| **Owner** | Single display — duplication removed |

### Role-based actions

| Component | Behavior |
|-----------|----------|
| `PassportActionsPanel` | Guest sees connect CTA, not empty block |
| Open dispute / Report discrepancy | Guarded with `isConnected` |
| `SellerContactButton` | Disabled (not hidden) when no wallet |

### Trust zone (`PassportTrustBanner`)

| Branch | UI |
|--------|-----|
| Reset warning | Metadata updated after verification |
| Dispute | Active dispute state |
| **UNVERIFIED** | `ShieldOff` icon · "Not yet verified" + explanation · "Find a verifier →" link |
| Logic order | reset warning → dispute → unverified → null |

### Address formatting

| Item | Detail |
|------|--------|
| Canonical formatter | `shortAddress()` in `lib/web3/wallet-display.ts` — `·` separator |
| Alias | `navShortAddress = shortAddress` (backward compatible) |
| Consolidation | Local copies removed from `EnsWalletLink`, `use-ens-profile`, `xmtp/helpers` |
| Removed | `WalletAddress` dead component |

### Metadata history (`PassportUriHistory`)

| Feature | Detail |
|---------|--------|
| Default state | Collapsed; shows entry count |
| `ar://` URIs | Clickable via `arUriToHttp()` gateway |
| Author | Linked to `/profile/{address}` |
| Props | `chainId` added for gateway resolution |

### Discussion (`NostrCommentsSection`)

| Topic | Behavior |
|-------|----------|
| Author display | EVM address from `["evm", address]` tag |
| Legacy comments | No tag → "Kargain user" |
| Removed | `npubLink`, `shortPk`, nip19, njump.me links |
| Guest | Reply/Like disabled; composer disabled; feed readable |
| Copy | Relay terminology removed from UI |

## 20. Notifications + watchlist — definition of done (June 2026)

**Status:** Full notifications stack and watchlist tab shipped on `/notifications`.

### Watchlist (NIP-51)

| Item | Detail |
|------|--------|
| Rename | "Garage" → **Watchlist** across UI |
| Hook | `hooks/use-watchlist.ts` — load/add/remove with optimistic toggle |
| Detail | `WatchlistButton` on passport detail (aside column) |
| Tab | `WatchlistClient` — grid of active listings from watched token IDs at `?tab=watchlist` |

### Notifications (full stack)

| Layer | Detail |
|-------|--------|
| Schema | `disputeOpenedAt` on `passport` in `ponder.schema.ts` (**VPS reindex required**) |
| Read state | `lib/nostr/notification-state.ts` — NIP-78 kind 30078; encrypted via `encryptAppPayload` / `decryptAppPayload` in `key-manager.ts`; `lastSeenAt` per channel; merge via `max()` |
| Ponder API | `GET /passports/batch`, `/listings/batch`, `/notifications/:address`; builder in `src/api/notifications-query.ts` |
| Hooks | `NotificationsProvider` → `usePonderNotifications` (30s poll) + `useWatchlistNotifications` (60s poll + IDB snapshot diff) + `useNostrNotificationsSub` (live `#p` + `#d`) |
| UI | Alerts tab (default) + Watchlist tab; mobile nav tab 4: **Alerts** / Bell + unread dot |

### Key modules

| File | Role |
|------|------|
| `lib/nostr/notification-state.ts` | NIP-78 load/save/merge |
| `lib/notifications/types.ts` | `NotificationItem`, enums |
| `src/api/notifications-query.ts` | Ponder feed builder |
| `hooks/use-notification-state.tsx` | Provider + NIP-78 + `markRead` |
| `hooks/use-notifications-feed.ts` | Context consumer |
| `hooks/use-unread-notifications-count.ts` | Nav badge count |
| `components/notifications/notifications-shell.tsx` | Tab shell |
| `components/notifications/notifications-client.tsx` | Alerts inbox |
| `components/notifications/notification-row.tsx` | Row UI |

### Technical debt

- `ownedTokenIds: []` for Nostr `#d` subscription — Phase 2 needs profile query for owned passport IDs
- VPS reindex required for `disputeOpenedAt` on historical rows
- N+1 query in `buildNotificationFeed` — batch SQL in Phase 2

### Remaining (not blocking)

- VPS reindex — [VPS-PONDER-REINDEX.md](./VPS-PONDER-REINDEX.md)
- Nostr `#d` subscription for owned passports (Phase 2)
- Tx-level record grouping in notification rows (Phase 2)
- Playwright E2E for notifications flow
