# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries.

**Multi-chain platform** — Kargain is designed to run on multiple networks, not a single L2. **Base Sepolia** is the current **integration testnet**; Base mainnet and additional chains follow validation. Do not treat “only Base Sepolia exists today” as a permanent product constraint when designing contracts, indexing, env config, or UI.

MIT License · Open Source

---

## Multi-chain platform (read first)

This is a **core product principle**, not a future nice-to-have.

| | |
|---|---|
| **Vision** | One marketplace and passport protocol across chains. Users choose where their passport lives; listings and trust state are chain-scoped but the product is not. |
| **Today** | **Base Sepolia (84532)** — contracts, Ponder indexer, and smoke validation. Optional **Hardhat (31337)** for local E2E. |
| **Next** | **Base mainnet (8453)** after Sepolia validation, then **Ethereum mainnet (1)** as canonical trust layer (bridge: one token on one chain at a time). |
| **Already chain-aware** | `lib/web3/deployment-addresses.ts` (`*_BY_CHAIN` env maps), `lib/web3/supported-chains.ts`, chain selector in app shell, per-chain manifests (`deployments/<chainId>.json`). |
| **Chain-agnostic** | Passport photos and metadata on **Arweave**; Nostr comments/favorites; XMTP messaging — not tied to a single chain. |
| **When deciding** | Prefer parameterized `chainId`, avoid hardcoding 84532 outside defaults/tests, and ask whether a feature should work on the *next* chain before shipping Base-only shortcuts. |

Details: local `docs/REFERENCE.md` § Chain Architecture (gitignored)

---

## How it works

### KarPassport

Anyone can **permissionlessly mint** a KarPassport NFT at [`/passport/new`](/passport/new). Vehicle details and photos are stored on Arweave (via client-side Irys upload). Each passport starts **UNVERIFIED**.

An **active verifier** (address with an active stake in `KarProStaking`, not the token owner) can **verify** the passport on-chain. The owner may update metadata while **UNVERIFIED**, or while **VERIFIED** — anchor field changes reset verification (Variant C); cosmetic-only edits keep verified status.

Anyone may **dispute** a verified passport. An active verifier **resolves** disputes: uphold keeps VERIFIED status; reject clears verification and returns the passport to UNVERIFIED. Owners and third parties can append **rich on-chain records** (service history, discrepancies, attestations).

### KarProPass & KarProStaking (Model X)

Soulbound credential for verification professionals — **one pass per wallet**, non-transferable.

Becoming a verifier is a **single permissionless action**: stake **0.05 ETH** via `KarProStaking.becomeVerifierNative` → receive a KarProPass. **Active stake** (`isActiveVerifier`) is the source of truth for verifier status — not KarProPass balance. Stake is **fully refundable** — no slash, no delay. `leave()` burns the pass and returns the stake.

Verifier identity (category, display name, metadata URI) is stored on-chain and indexed by Ponder. Transparency is public; buyers judge verifiers by profile and history. Kargain revenue comes **only from marketplace sales** (0.1% platform fee).

Verifier categories: `MECHANIC` · `GARAGE` · `INSPECTOR` · `BROKER` · `DEALER` · `OTHER`

Active verifiers verify passports, resolve disputes, and append attestations. Marketplace pro-fee discounts also require an active stake.

### MarketplaceEscrow

UUPS-upgradeable escrow. Sellers list KarPassport NFTs with a **fiat price** (USD or EUR, stored 1e8). Buyers pay the on-chain quote via **native ETH** or **USDC**, priced through **Chainlink** feeds. Platform fee: **0.1%** (`platformFeeBps: 10`); pro seller discount is **0** (`proFeeBps: 0`) in Model X. Passport verification status does not block listing or purchase — transparency is enforced in the UI.

### Off-chain layers

- **Ponder** indexes contract events and serves listing/passport/verifier APIs ([production](https://ponder.kargain.com)). Browse cards may sample `getPassportStatus` on-chain when Ponder status may be stale (G4).
- **Nostr** powers public comments and garage favorites (NIP-51).
- **XMTP** provides encrypted buyer–seller messaging.

---

## Architecture

| Layer | Role |
|-------|------|
| **Next.js frontend** | App UI, wallet auth (SIWE), client-side Arweave uploads |
| **Ponder indexer** | Indexes deployed chain events (Base Sepolia today); REST API (`/listings`, `/passports`, `/verifiers`, …) — extend per chain as deployments grow |
| **EVM contracts (per chain)** | KarPassport, KarProPass, KarProStaking (immutable); MarketplaceEscrow (UUPS proxy) — same Model X stack redeployed per network |
| **Arweave** (via Irys, user-pays in browser) | Permanent photos and passport metadata — chain-agnostic `ar://` URIs; gateway resolution is chain-aware |
| **Nostr** | Public comments (NIP-01), favorites (NIP-51) |
| **XMTP** | End-to-end encrypted buyer–seller messaging |

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind v4, wagmi 2, viem |
| Indexer | Ponder 0.16, PostgreSQL |
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 |
| Storage | Arweave via Irys (`@irys/web-upload`) |
| Social | Nostr (NIP-01, NIP-02, NIP-51) |
| Messaging | XMTP |
| Chain | **Multi-chain product** — **Base Sepolia (84532)** for testnet validation today; Base mainnet + Ethereum planned (see § Multi-chain platform above) |

## Phase status (June 2026)

| Area | Status |
|------|--------|
| **UI complete (June 2026)** | **Complete** — all contract functions have UI coverage; all Ponder API endpoints have UI consumers |
| **KarPassport v1.1 (Phases 1–5)** | **Complete** — merged to `master` |
| **Trust / UX gap (plan A–J core)** | **Complete** — BuyRiskModal, verifier badges, G1/G2 Ponder, metadata diff, DISPUTED filter |
| **Phase 5 polish (PR5a–d)** | **Complete** — typed record timeline, attestation UI, browse chain-status warning, Basescan verify |
| **Marketplace filters & shell (June 2026)** | **Complete** — top filter bar + drawer, mobile 5-tab nav, ENS on address displays, photo upload zone |
| **Passport Irys upload (June 2026)** | **Complete** — batch `uploadFolder`, chain-aware `ar://` gateway, smart-wallet pre-check, unified create/edit flow |
| Contracts (Model X) | v1.1 on Base Sepolia; verified on [Basescan](https://sepolia.basescan.org); Hardhat + T10/E5 matrix |
| Ponder indexer | Production at https://ponder.kargain.com — **reindex required** after filter schema columns ([runbook](docs/VPS-PONDER-REINDEX.md)) |
| ABIs & addresses | `lib/web3/deployment-addresses.ts` + `deployments/84532.json` manifest |
| Passport UI | Mint (drag-and-drop photos), edit (Variant C), verify/dispute/resolve, attestation, records timeline, marketplace trust gates |
| Browse UX | Top filter bar + drawer (status, price, make, fuel, year, mileage, body, condition, vehicle type, location, colour); server-side facets; chain-status sample on cards (G4) |
| KarPro & trust network | `/kar-pro`, `/verifiers`, `/verifier/[address]`, `/pro/[slug]` (dynamic showroom; `PRO_SLUGS` empty until owner adds slug after staking) |
| Local E2E (31337) | `pnpm deploy:local`, `pnpm test:e2e`, `./scripts/dev-local.sh` |

### UI complete — June 2026

All contract functions exposed in the app UI. All Ponder HTTP endpoints consumed by the frontend.

**App routes (primary):**

| Route | Purpose |
|-------|---------|
| `/` | Marketplace browse (filter bar + infinite scroll) |
| `/passport/new` | Mint KarPassport (Irys upload + wizard) |
| `/passport/[tokenId]/edit` | Edit metadata (Variant C) |
| `/marketplace/[tokenId]` | Listing / passport detail |
| `/marketplace/[tokenId]/edit` | Seller listing edit |
| `/kar-pro` | KarPro onboarding + credential card |
| `/verifiers` | Verifier directory |
| `/verifier/[address]` | Verifier profile (empty state if never staked) |
| `/pro/[slug]` | Professional showroom (`PRO_SLUGS` lookup; 404 if unknown slug) |
| `/profile/[handle]` | Public wallet profile |
| `/profile/edit` | Profile edit + connect wallet |
| `/messages` | XMTP inbox |
| `/messages/[conversationId]` | DM thread |
| `/notifications` | Alerts placeholder + KarPro CTA when eligible |

**Shell:** Mobile — logo · KarPro (when eligible) · wallet (top); Marketplace · Messages · Create FAB · Alerts · Profile (bottom). Desktop — Verifiers · Messages · Become KarPro · Create passport · chain · wallet. No duplicated actions between top and bottom nav on mobile.

**`PRO_SLUGS`:** `{}` (empty). After staking on `/kar-pro`, add `{ "your-slug": "0x…" }` in [`lib/web3/pro-slugs.ts`](lib/web3/pro-slugs.ts) to enable `/pro/[slug]` and profile showroom links.

### Passport storage & Irys upload (June 2026)

Photos and metadata JSON upload **client-side** via `@irys/web-upload`. The user’s wallet pays Irys storage (deposit + upload signatures). No server upload API for passports.

| Topic | Implementation |
|-------|----------------|
| **Batch photos** | `uploadFolder` — one wallet signature for all photos on create or edit |
| **Single session** | `uploadPassportToIrys()` — wallet check → photos → metadata JSON on one uploader |
| **Create / edit parity** | Both wizards use the same upload helper, progress panel, and error formatting |
| **Smart wallet block** | `eth_getCode` pre-check before any Irys `fund()` — EIP-7702 and contract accounts get a clear message; no tx sent |
| **Metadata-only edit** | Changing fields without new photos still runs wallet check + metadata upload (may trigger `fund()`) |
| **Gateway (multichain)** | Base Sepolia / testnets → `https://gateway.irys.xyz/{id}`; Base + Ethereum mainnet → `https://arweave.net/{id}` via `lib/storage/ar-gateway.ts` |
| **Bundler node** | Selected from **connected wallet chain ID** — devnet for 84532, `node2.irys.xyz` for 8453/1 (`lib/storage/irys-client.ts`) |

**Wallet requirement for mint/edit upload:** standard **EOA** (MetaMask classic account, Rabby, Rainbow, etc.). Smart Account / EIP-7702 wallets are blocked before upload with instructions to switch accounts.

**Tests:** `test/irys-compatibility.test.ts` · `test/passport-upload.test.ts` · `test/ar-gateway.test.ts` (run with `node --import tsx --test test/*.test.ts`)

**Deferred:** browser E2E (Playwright + mock wallet) for upload UX — separate task; unit tests cover compatibility detection today.

---

**Next steps:**

1. Ponder reindex (schema gained `condition`, `vehicleType`, `colour`, `locationLabel` on passports) — [runbook](docs/VPS-PONDER-REINDEX.md)
2. Stake on `/kar-pro` and add your pro slug to `PRO_SLUGS`
3. Sepolia smoke validation (checklist below) — use an **EOA** wallet for passport photo upload
4. Deploy latest frontend to Vercel after Irys commits land on `master`
5. **Multi-chain:** Base mainnet (8453) contract deploy + env/manifests after Sepolia sign-off; extend Ponder per chain (see [docs/passport-v1.1-spec.md](docs/passport-v1.1-spec.md) §18)

**Sepolia smoke checklist:**

- [ ] Mint passport with drag-and-drop photos (EOA wallet) → UNVERIFIED; photos load via Irys devnet gateway
- [ ] Browse filters (top bar + drawer: status, make, price, condition, etc.)
- [ ] Active verifier verify → VERIFIED
- [ ] KarPro stake on `/kar-pro` → credential + `/verifiers` listing
- [ ] Add slug to `PRO_SLUGS` → `/pro/[slug]` showroom loads
- [ ] XMTP messages + wallet connect / disconnect
- [ ] List on marketplace → buy or quote preview
- [ ] Edit passport metadata only (no new photos) → new `ar://` URI on-chain
- [ ] Edit with new photos → interleaved photo order preserved in metadata
- [ ] Dispute / resolve (optional)

**Tests:** `pnpm hardhat test` · `node --import tsx --test test/*.test.ts` (app unit tests, incl. Irys) · `pnpm test:metadata` · `pnpm test:listing` · `pnpm test:ponder` · `pnpm test:trust` · `pnpm test:records` · `pnpm test:confirm-status` · `pnpm test:verify` · `pnpm test:e2e` (localhost 31337 only)

Spec: [docs/passport-v1.1-spec.md](docs/passport-v1.1-spec.md) (§17 UI complete) · Ponder reindex: [docs/VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md)

---

## Development setup

### Prerequisites

- Node.js 20+
- pnpm
- A wallet with Base Sepolia ETH (for on-chain testing)
  Faucet: https://faucet.quicknode.com/base/sepolia

### Install

```bash
git clone https://github.com/kargain-com/kargain.git
cd kargain
pnpm install
cp .env.example .env.local
```

### Configure `.env.local`

See `.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | App origin (default `http://localhost:3000`) |
| `SIWE_SESSION_SECRET` | HMAC secret for SIWE session cookies — **required in production** |
| `NEXT_PUBLIC_CHAIN_ID` | Default chain — `84532` for Base Sepolia |
| `NEXT_PUBLIC_XMTP_ENV` | XMTP environment — `dev` or `production` |
| `NEXT_PUBLIC_RPC_BY_CHAIN` | JSON map of chain ID → RPC URL |
| `PONDER_SQL_API_URL` | Ponder REST API (local: `http://localhost:42069`) |
| `BASE_SEPOLIA_RPC_URL` | RPC for Hardhat `baseSepolia` network |
| `DEPLOYER_PRIVATE_KEY` | Optional — Hardhat deploy account (never commit) |
| `ETHERSCAN_API_KEY` | Basescan API key for contract verification |

Deployed contract addresses live in `lib/web3/deployment-addresses.ts` (optional `NEXT_PUBLIC_*` overrides in `.env.local`).

### Run

```bash
# Next.js frontend
pnpm dev

# Ponder indexer (requires PostgreSQL — see docker-compose.yml)
pnpm ponder:dev
```

### Local development (chain 31337)

Full Model X stack on a persistent Hardhat node with Ponder indexing and optional frontend:

```bash
# One terminal — Postgres + Hardhat node + deploy + Ponder
./scripts/dev-local.sh

# Another terminal — frontend on localhost chain
export NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=1
export NEXT_PUBLIC_CHAIN_ID=31337
eval "$(node --import tsx scripts/lib/print-local-env.ts)"
pnpm dev
```

Manual steps:

```bash
npx hardhat node          # terminal 1
pnpm deploy:local         # terminal 2 (writes deployments/31337.json)
PONDER_ENABLE_LOCAL=1 PONDER_START_BLOCK_31337=0 pnpm ponder:dev   # terminal 3
pnpm test:e2e             # viem lifecycle (+ optional Ponder checks)
```

One-shot CI-style E2E: `./scripts/e2e-local.sh`

Open http://localhost:3000

### Create a passport

Connect a wallet, then visit `/passport/new`. Irys upload and on-chain `mintPassport` are wired; success navigates to the passport detail page.

### Contracts (local)

```bash
pnpm hardhat compile    # compile Solidity
pnpm hardhat test       # contract tests (node:test + viem)
pnpm test:metadata      # metadata diff / parse / G1 helpers
pnpm test:listing       # marketplace filter query
pnpm test:ponder        # Ponder G1 field + indexer unit tests
pnpm test:trust         # buy-risk and trust banner helpers
pnpm test:records       # typed record labels (PR5a)
pnpm test:confirm-status # browse chain vs Ponder drift helpers (PR5c)
pnpm test:verify          # Basescan verify constructor args (PR5d)
pnpm test:e2e           # localhost lifecycle (requires hardhat node + deploy:local)
pnpm deploy:local       # deploy Model X to running Hardhat node → deployments/31337.json
pnpm deploy:v1.1        # Phase 5 partial redeploy (KarPassport + Marketplace on Sepolia)
pnpm verify:v1.1        # Verify v1.1 contracts on Basescan (needs ETHERSCAN_API_KEY)
pnpm deploy:base-sepolia # full Model X greenfield deploy on Sepolia
```

After compile, refresh ABIs:

```bash
node scripts/export-abis.mjs
```

---

## Contracts (Base Sepolia — testnet)

Network: Base Sepolia (chain **84532**) · Model X v1.1 partial redeploy: June 2026  
*First production testnet deployment; same contract stack will deploy to additional chains.*

| Contract | Address |
|----------|---------|
| KarProPass | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` |
| KarProStaking | `0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31` |
| KarPassport (v1.1) | `0x6378469256907D7DC14BBfce0261ceDE22314507` |
| MarketplaceEscrow (proxy) | `0x4FC74e0B7eE0A741707A553D43Efff68126D198B` |
| MarketplaceEscrow (impl) | `0x7d37e7cbcc42308264B608429a82D03B7C3112F4` |
| Deployer / upgradeAuthority | `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77` |
| platformRecipient | `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` |

**Deprecated (Model X pre-v1.1):** KarPassport `0xCfA1eAB…`, Marketplace proxy `0xcD40C83…` — not indexed after Phase 5 reindex.

Deploy v1.1 (partial): `pnpm deploy:v1.1` · Verify on Basescan: `pnpm verify:v1.1` (requires `ETHERSCAN_API_KEY` in `.env.local`) · Full greenfield: `pnpm deploy:base-sepolia`

After deploy, run `pnpm verify:v1.1` locally to publish source for KarPassport, MarketplaceEscrow impl, and ERC1967 proxy on [Base Sepolia Basescan](https://sepolia.basescan.org). The script reads `deployments/84532.json` when present, otherwise falls back to committed addresses in `scripts/lib/load-deployment.ts`. Loads `ETHERSCAN_API_KEY` from `.env.local` / `.env`.

**Basescan (verified June 2026):**

| Contract | Explorer |
|----------|----------|
| KarPassport v1.1 | https://sepolia.basescan.org/address/0x6378469256907D7DC14BBfce0261ceDE22314507 |
| MarketplaceEscrow impl | https://sepolia.basescan.org/address/0x7d37e7cbcc42308264B608429a82D03B7C3112F4 |
| MarketplaceEscrow proxy | https://sepolia.basescan.org/address/0x4FC74e0B7eE0A741707A553D43Efff68126D198B |

### On-chain parameters

| Parameter | Value |
|-----------|-------|
| `minStakeNative` | 0.05 ETH (owner-adjustable; affects new verifiers only) |
| `platformFeeBps` | 10 (0.1%) |
| `proFeeBps` | 0 |
| Payment assets | Native ETH, USDC |

---

## Infrastructure

Production indexer runs via Docker Compose: **PostgreSQL + Ponder + cloudflared**.

- Ponder API: https://ponder.kargain.com
- RPC: publicnode (`startBlock: latest` in `ponder.config.ts`)
- Deploy workflow: `.github/workflows/deploy-ponder.yml`
- **After `ponder.schema.ts` changes:** run [docs/VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md) on VPS

Local stack:

```bash
docker compose up -d   # postgres + ponder (+ optional tunnel)
```

---

## Ponder API

| Endpoint | UI consumer |
|----------|-------------|
| `GET /listings` | `/` browse — `searchMarketplaceListings` |
| `GET /listings/facets` | Filter bar/drawer — `useFacets`, `fetchListingFacets` |
| `GET /listings/:tokenId` | Marketplace detail, favorites, pro showroom |
| `GET /passports` | Verifier empty state — `getPassportsByVerifier` |
| `GET /passports/:tokenId` | Passport/marketplace detail — `fetchPassportDetail` |
| `GET /profile/:address/passports` | Profile page — `getProfileData` |
| `GET /profile/:address/listings` | Profile, pro showroom — `getProfileData`, `getProShowroomData` |
| `GET /verifiers` | `/verifiers` — `fetchVerifierDirectory` |
| `GET /verifiers/:address` | `/verifier/[address]`, pro showroom — `fetchVerifierDetail`, `getProShowroomData` |
| `GET /verifiers/:address/attestations` | Verifier page, pro showroom — `getVerifierAttestations` |

All endpoints above are consumed by the Next.js app.

---

## Architecture notes

- **Multi-chain** — Kargain is a multi-chain platform. Base Sepolia is the active test deployment; design for per-chain contract manifests, RPC maps, Ponder indexing, and chain-aware Irys/gateway config rather than assuming a single network forever.
- **Arweave metadata** — `ar://` URIs are identical on every chain; only HTTP gateway and Irys bundler selection vary by network.
- **VIN** and vehicle attributes live in Arweave metadata (not on-chain).
- Disputed passports can still be listed and sold; buyers see status in the UI (including buy-risk modal and typed dispute timeline).
- Passport detail confirms on-chain status when it differs from Ponder; marketplace browse samples up to 12 visible cards per page.
- Ponder indexes verifier `metadataURI` from `ProPassMinted` / `ProfileUpdated` and record `description` / `evidenceCID` from `RecordAppended`.

## Known limitations & technical debt

- **Smart wallets + Irys** — EIP-7702 and contract accounts cannot send the direct ETH transfer Irys `fund()` requires. App detects via `eth_getCode` and blocks before upload. Workaround: EOA on the target chain. A server-side or AA-compatible storage path is a future product decision.
- **upgradeAuthority** — currently the deployer EOA, not a timelock.
- **`scripts/deploy-proxy.ts`** — references a stale MarketplaceEscrow impl; use `pnpm deploy:v1.1` or `pnpm deploy:base-sepolia`.
- **`ProPassBurned`** — does not snapshot verifier profile (live state only).
- **Desktop filter bar** — `overflow-hidden` on the filter row can clip controls around ~768px; may need wrap or scroll affordance.
- **Ponder reindex pending** — passport filter columns (`condition`, `vehicleType`, `colour`, `locationLabel`) require VPS reindex before facets match on-chain metadata.
- **Multi-chain indexing** — Ponder today indexes Base Sepolia only; each new chain needs deployment manifest + indexer config (see spec §18).
- **Deferred (Phase 6+):** owner service-history UI, evidence upload on report/clarification forms, full browse N-chain confirm, `GET /passports/:id/trust`, `buyWithUsdc` UI, Playwright browser E2E for passport upload flows.

**Fixed (June 2026):** `kar-pro-credential-card` showroom link uses `proSlugForAddress()` instead of incorrect `PRO_SLUGS[address]` lookup. **Irys:** batch photo upload, devnet gateway routing, IPFS removed from env/code, create/edit upload parity, smart-wallet pre-check.

## Future work (multi-chain platform)

| Priority | Task | Notes |
|----------|------|-------|
| **Ops** | Ponder VPS reindex for filter facets | [runbook](docs/VPS-PONDER-REINDEX.md) |
| **Ops** | Sepolia smoke validation | EOA wallet for Irys; checklist above |
| **Ops** | First pro slug in `PRO_SLUGS` | After KarPro stake |
| **Chain 1** | Base mainnet (8453) deploy | Same Model X stack; update `deployments/8453.json`, env maps, Irys mainnet node |
| **Chain 2** | Ethereum mainnet (1) | Canonical trust layer; burn/mint bridge — one token on one chain at a time |
| **Indexer** | Per-chain Ponder (or multi-chain config) | Extend `ponder.config.ts` / manifests as networks go live |
| **Storage** | Validate Irys on each new chain | Extend `BASE_CHAIN_IDS` / gateway maps in `irys-client.ts` and `ar-gateway.ts` |
| **QA** | Playwright E2E + mock wallet | Smart-wallet block message, upload progress, edit metadata-only |
| **Product** | Smart-wallet storage path | Optional server-side or alternative permanent storage if EOA requirement is unacceptable |

## Contributing

This project is MIT licensed. PRs welcome.
Open an issue before starting significant work.

## License

MIT — see [LICENSE](LICENSE).
