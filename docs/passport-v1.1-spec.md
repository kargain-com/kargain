# KarPassport v1.1 — Product & Contract Spec

Status: **approved** (Phase 1 implementation)  
Branch: `feat/passport-v1.1`  
Base deploy: Base Sepolia Model X (June 2026) — redeploy pending Phase 5 gate

## 1. Philosophy

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
- **Only verifier** resolves DISPUTED via `resolveDispute(uphold)`.

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

| Phase | Deliverable |
|-------|-------------|
| **1** | Spec + `setPassportURI` + tests (no deploy) |
| **2** | Metadata schema v1.1 shared modules |
| **3** | Ponder schema, uri_history, trust flags, UI blocks |
| **4** | Localhost 31337 E2E |
| **5** | Single Sepolia redeploy + reindex + merge to master |

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

Run metadata unit tests: `pnpm test:metadata`.

## 12. Phase 3 checklist (Ponder + UI)

### Ponder

- [x] `passport_uri_history` table + `vin_index`
- [x] Extended `passport` trust/VIN denorm fields
- [x] `VerificationReset` handler
- [x] D6 `disputeWithdrawnAt` on `RecordAppended`
- [x] Metadata indexer on mint/URI update (Arweave fetch + `parseMetadataJson`)
- [x] REST: passport detail with `uriHistory`, listings join + facets

### UI blocks

- [x] Passport actions (verify / dispute / resolve / withdraw / report)
- [x] Edit passport wizard + anchor/cosmetic confirm modal
- [x] URI history timeline
- [x] Marketplace list / delist / buy wiring
- [x] Browse verified-first + status badges / duplicate VIN warnings
- [x] Profile page data from Ponder
- [x] Kar Pro join/leave staking
- [x] Verifier detail page (`/verifier/[address]`)

Run handler unit tests: `pnpm test:ponder`.

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
