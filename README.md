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
- **Nostr** powers public comments (NIP-01), watchlist favorites (kind 30000 replaceable list), and notification read-state sync (NIP-78 kind 30078). Identity is wallet-derived (`kargain-nostr-v1` / `kargain-aes-v1`); comments tag authors with `["evm", address]`.
- **XMTP** provides encrypted buyer–seller messaging.

---

## Architecture

| Layer | Role |
|-------|------|
| **Next.js frontend** | App UI, wallet auth (SIWE), client-side Arweave uploads |
| **Ponder indexer** | Indexes deployed chain events (Base Sepolia today); REST API (`/listings`, `/passports`, `/verifiers`, …) — extend per chain as deployments grow |
| **EVM contracts (per chain)** | KarPassport, KarProPass, KarProStaking (immutable); MarketplaceEscrow (UUPS proxy) — same Model X stack redeployed per network |
| **Arweave** (via Irys, user-pays in browser) | Permanent photos and passport metadata — chain-agnostic `ar://` URIs; gateway resolution is chain-aware |
| **Nostr** | Public comments (NIP-01), watchlist (NIP-51), notification read-state (NIP-78) |
| **XMTP** | End-to-end encrypted buyer–seller messaging |

**Docs (git):** [passport-v1.1-spec.md](docs/passport-v1.1-spec.md) · [VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md)  
**Local only (gitignored):** [AGENTS.md](AGENTS.md) (Cursor agent instructions) · `docs/HANDOFF.md`, `docs/SESSION.md`, `docs/REFERENCE.md`, `docs/ROADMAP.md`, `docs/design-spec.md`

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind v4, wagmi 2, viem |
| Indexer | Ponder 0.16, PostgreSQL |
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 |
| Storage | Arweave via Irys (`@irys/web-upload`) |
| Social | Nostr (NIP-01, NIP-51, NIP-78) |
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
| **Passport detail UX (June 2026)** | **Complete** — identity-first layout, Nostr hardening, role-based actions, trust banners, `shortAddress`, guest-readable comments |
| **Notifications + watchlist (June 2026)** | **Complete** — NIP-78 read-state, Ponder feed API, alerts inbox, watchlist tab, nav badge |
| **Profile unified (June 2026)** | **Complete** — single `/profile/[handle]` page; verifier content absorbed; `/verifier/[address]` → 308 redirect |
| **Verifiers redesign + nav (June 2026)** | **Complete** — intent banner, filters, XMTP verification request; shared NOSTR_RELAYS; Verifiers secondary nav button |
| **Marketplace homepage (June 2026)** | **Complete** — compact stats above filter bar; VERIFIED listing card border and verifier attribution |
| Contracts (Model X) | v1.1 on Base Sepolia; verified on [Basescan](https://sepolia.basescan.org); Hardhat + T10/E5 matrix |
| Ponder indexer | Production at https://ponder.kargain.com — VPS uses `sepolia.base.org` RPC; reindex after schema changes ([runbook](docs/VPS-PONDER-REINDEX.md)) |
| ABIs & addresses | `lib/web3/deployment-addresses.ts` + `deployments/84532.json` manifest |
| Passport UI | Mint (drag-and-drop photos), edit (Variant C), verify/dispute/resolve, attestation, records timeline, marketplace trust gates |
| Browse UX | Compact homepage stats above filter bar; top filter bar + drawer (status, price, make, fuel, year, mileage, body, condition, vehicle type, location, colour); server-side facets; VERIFIED card accent border + verifier attribution; chain-status sample on cards (G4) |
| KarPro & trust network | `/kar-pro`, `/verifiers`, `/profile/[address]` (canonical verifier profile), `/verifier/[address]` (redirects to profile), `/pro/[slug]` (dynamic showroom; slug set when staking on `/kar-pro`) |
| Local E2E (31337) | `pnpm deploy:local`, `pnpm test:e2e`, `./scripts/dev-local.sh` |

### UI complete — June 2026

All contract functions exposed in the app UI. All Ponder HTTP endpoints consumed by the frontend.

**App routes (primary):**

| Route | Purpose |
|-------|---------|
| `/` | Marketplace browse — compact stats line + filter bar + infinite scroll |
| `/passport/new` | Mint KarPassport (Irys upload + wizard) |
| `/passport/[tokenId]/edit` | Edit metadata (Variant C) |
| `/marketplace/[tokenId]` | Listing / passport detail |
| `/marketplace/[tokenId]/edit` | Seller listing edit |
| `/kar-pro` | KarPro onboarding + credential card |
| `/verifiers` | Verifier directory — intent banner, filters, XMTP request |
| `/verifier/[address]` | Permanent redirect to `/profile/[address]` |
| `/pro/[slug]` | Professional showroom (slug from KarPro staking / Ponder; 404 if unknown slug) |
| `/profile/[handle]` | Public wallet profile (verifier tabs: verified, disputes, attestations) |
| `/profile/edit` | Profile edit + connect wallet |
| `/messages` | XMTP inbox |
| `/messages/[conversationId]` | DM thread |
| `/notifications` | Alerts inbox + watchlist tab (`?tab=watchlist`) |

**Shell:** Mobile — logo · Verifiers (bordered icon) · KarPro (when eligible) · wallet (top); Marketplace · Messages · Create FAB · Alerts · Profile (bottom). Desktop — Verifiers (secondary button) · Alerts · Messages · Become KarPro · Create passport · chain · wallet. No duplicated actions between top and bottom nav on mobile.

### Notifications + watchlist (June 2026)

Full notifications stack: Ponder on-chain events, watchlist snapshot diffs, and Nostr replies/likes. Cross-device read state via encrypted NIP-78 (kind 30078).

| Topic | Implementation |
|-------|----------------|
| **Watchlist** | `hooks/use-watchlist.ts` — Nostr kind 30000 list (`kargain-favorites`); `WatchlistButton` on passport detail; `WatchlistClient` grid at `/notifications?tab=watchlist` |
| **Read state** | `lib/nostr/notification-state.ts` — NIP-78 `#d: kargain-notifications-v1`; AES-GCM via `encryptAppPayload` / `decryptAppPayload`; `lastSeenAt` per channel (`ponder`, `nostr`, `watchlist`); merge via `max()` |
| **Ponder feed** | `GET /notifications/:address`, `/passports/batch`, `/listings/batch`; builder in `src/api/notifications-query.ts`; `disputeOpenedAt` on `passport` (reindex required) |
| **Hook tree** | `NotificationsProvider` → `usePonderNotifications` (30s poll) + `useWatchlistNotifications` (60s poll + IDB snapshot diff) + `useNostrNotificationsSub` (live `#p` subscription) |
| **UI** | `/notifications` — Alerts tab (default) + Watchlist tab; mobile nav tab 4: **Alerts** / Bell + unread dot |

**Key modules:** `lib/notifications/types.ts` · `hooks/use-notification-state.tsx` · `components/notifications/notifications-shell.tsx` · `components/notifications/notifications-client.tsx`

**Phase 2 / ops:** Nostr `#d` subscription for owned passport comments (`ownedTokenIds` currently `[]`); VPS reindex for `disputeOpenedAt`; batch SQL for record queries in feed builder.

**Pro slug:** Set when staking on `/kar-pro` (stored in on-chain metadata and indexed by Ponder). Enables `/pro/[slug]` and profile showroom links via `verifierProfile.slug`.

### Profile unified — June 2026

Single canonical profile page. All verifier content absorbed.

| Iter | Deliverable |
|------|-------------|
| 1 | `lib/nostr/profile.ts` — `fetchNostrProfile`, `publishNostrProfile` (NIP-39 kind 0) |
| 1 | `hooks/use-nostr-profile.ts` — `useNostrProfile` |
| 2 | `components/identity/identity-header.tsx` — unified header (avatar, name, KarPro badge, links, actions) |
| 2 | `hooks/use-is-profile-owner.ts` — `useIsProfileOwner` |
| 3 | `/profile/edit` — Nostr kind 0 personal edit (avatar, name, bio, website) + KarPro read-only summary |
| 4 | `/profile/[handle]` — unified profile (absorbs verifier content); adaptive tabs by role |
| 5 | `/verifier/[address]` → 308 permanent redirect to `/profile/[address]` |
| 5 | Disputes tab on ProfilePage (KarPro only) |
| 5 | All internal `/verifier/` links updated to `/profile/` |
| 5 | README + passport-v1.1-spec.md: `PRO_SLUGS` / `proSlugForAddress` stale refs removed |

**Identity data priority:** display name — KarProPass.name → ENS name → `navShortAddress`; avatar — Nostr kind 0 picture → ENS avatar → initials; bio — Nostr kind 0 about; website — Nostr kind 0 website (personal) / Arweave metadata (KarPro pro).

**Editing surfaces:** `/profile/edit` → Nostr kind 0 (all users): avatar, name, bio, website. `/kar-pro` → on-chain + Arweave (KarPro only): displayName, category, slug, pro description.

**Slug architecture:** stored in Arweave JSON (canonical) + Ponder `verifier.slug` (denormalized); on-chain `metadataURI` pointer only (slug not a contract field); API `GET /verifiers/by-slug/:slug` → `/pro/[slug]` page. Static `PRO_SLUGS` file never existed — was stale documentation only.

**Key modules:** `components/profile/profile-page.tsx` · `components/identity/identity-header.tsx` · `app/actions/kar-pro-verifier.ts` · `lib/nostr/profile.ts`

### /verifiers redesign + nav + marketplace / — June 2026

#### /verifiers (Iterations 1–5 + 1b + relay refactor)

| File | Change |
|------|--------|
| lib/nostr/relays.ts | Created — shared NOSTR_RELAYS constant, no directive |
| lib/nostr/fetch-profile-server.ts | Server-safe Nostr fetch (NIP-39 #i); imports from relays.ts |
| lib/nostr/nostr-client.ts | Inline relay list replaced with import from relays.ts |
| app/actions/verifier-directory.ts | Added joinedAt, nostrPicture (batch Nostr) to VerifierDirectoryEntry |
| components/verifier/verifier-directory.tsx | Full rewrite: enriched cards, filter bar, category chips, sort |
| components/verifier/verifiers-intent-banner.tsx | Created — role-aware personalization (KarPro / unverified / neutral) |
| components/verifier/verification-request-button.tsx | Created — XMTP contact with lazy passport pre-fill |
| app/verifiers/page.tsx | VerifiersIntentBanner + `#verifier-grid` (no hero band) |

#### Navigation

| File | Change |
|------|--------|
| components/shell/app-top-nav.tsx | Verifiers secondary button in right cluster (ShieldCheck + label on desktop; bordered icon on mobile; accent when active) |

#### Marketplace /

| File | Change |
|------|--------|
| app/page.tsx | Server-fetches stats; passes `activeListings`, `verifiedCount`, `activeVerifiers` to MarketBrowse |
| components/marketplace/market-browse.tsx | Compact ambient stats line above filter bar (`text-text-tertiary`, mono tabular-nums) |
| components/marketplace/listing-card.tsx | Verifier attribution (ShieldCheck + profile link on VERIFIED); semantic border-accent-warm for VERIFIED; hover border fixed (border-border-hover, not accent) |

#### Architecture decisions

- VERIFIED listing card: border-accent-warm (permanent, not hover)
- UNVERIFIED listing card: border-border-default, hover → border-border-hover
- Verifier attribution: row.verifier address only (no name/slug in listing row — links to /profile/{address})
- Stats source: fetchListingFacets() → totalActive + statusCounts.VERIFIED; getVerifierDirectory() → .length
- Homepage stats: `fetchListingFacets()` + `getVerifierDirectory()` in `app/page.tsx` (Server Component); passed as props to MarketBrowse; compact line above filter bar
- Nostr avatars: server-batched via fetchNostrProfileServer (NIP-39 ethereum:#i tag)
- Avatar priority: nostrPicture (server) → EnsAvatar (client ENS/identicon)
- Routing: slug non-empty → /pro/{slug}; else → /profile/{address}
- Filter state: local useState in VerifierDirectory (no URL sync — list is small)
- XMTP pre-fill: lazy getProfileData on click — no per-card render fetch

**Key modules:** `app/page.tsx` · `components/marketplace/market-browse.tsx` · `components/marketplace/listing-card.tsx` · `components/verifier/verifier-directory.tsx` · `components/verifier/verifiers-intent-banner.tsx` · `components/verifier/verification-request-button.tsx` · `components/shell/app-top-nav.tsx` · `lib/nostr/relays.ts`

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

### Passport detail page UX (June 2026)

`/marketplace/[tokenId]` — identity-first layout, hardened Nostr, and guest-readable discussion.

| Topic | Implementation |
|-------|----------------|
| **Nostr identity** | Wallet-derived keys only — no nsec export/import UI; canonical `kargain-nostr-v1` / `kargain-aes-v1` salts; auto-init on connect (`lib/nostr/key-manager.ts`) |
| **Layout** | Zone A header (title, status, owner) first; mobile identity before gallery; verifier in main column; no duplicate owner block |
| **Actions** | `PassportActionsPanel` connect CTA for guests; dispute/report require wallet; seller contact disabled when disconnected |
| **Trust** | `PassportTrustBanner` — reset → dispute → unverified (`ShieldOff`, "Find a verifier →") → null |
| **Addresses** | `shortAddress()` / `navShortAddress` in `lib/web3/wallet-display.ts` — single `·`-separated formatter app-wide |
| **URI history** | `PassportUriHistory` collapsed by default; clickable `ar://` via `arUriToHttp()`; author links to profile |
| **Comments** | EVM tag authors; legacy → "Kargain user"; guests read-only (no relay jargon in copy) |

---

**Next steps:**

1. Ponder reindex (`disputeOpenedAt`, filter columns `condition`, `vehicleType`, `colour`, `locationLabel`) — [runbook](docs/VPS-PONDER-REINDEX.md)
2. Stake on `/kar-pro` and set your pro slug during onboarding
3. Sepolia smoke validation (checklist below) — use an **EOA** wallet for passport photo upload
4. Deploy latest frontend to Vercel after Irys commits land on `master`
5. **Multi-chain:** Base mainnet (8453) contract deploy + env/manifests after Sepolia sign-off; extend Ponder per chain (see [docs/passport-v1.1-spec.md](docs/passport-v1.1-spec.md) §18)

**Sepolia smoke checklist:**

- [ ] Mint passport with drag-and-drop photos (EOA wallet) → UNVERIFIED; photos load via Irys devnet gateway
- [ ] Browse filters (top bar + drawer: status, make, price, condition, etc.)
- [ ] Active verifier verify → VERIFIED
- [ ] KarPro stake on `/kar-pro` → credential + `/verifiers` listing
- [ ] Stake on `/kar-pro` with a slug → `/pro/[slug]` showroom loads
- [ ] XMTP messages + wallet connect / disconnect
- [ ] List on marketplace → buy or quote preview
- [ ] Edit passport metadata only (no new photos) → new `ar://` URI on-chain
- [ ] Edit with new photos → interleaved photo order preserved in metadata
- [ ] Dispute / resolve (optional)
- [ ] Notifications — Alerts inbox, mark read, mobile unread dot; Watchlist tab (`?tab=watchlist`)

**Tests:** `pnpm hardhat test` · `node --import tsx --test test/*.test.ts` (app unit tests, incl. Irys) · `pnpm test:metadata` · `pnpm test:listing` · `pnpm test:ponder` · `pnpm test:trust` · `pnpm test:records` · `pnpm test:confirm-status` · `pnpm test:verify` · `pnpm test:e2e` (localhost 31337 only)

Spec: [docs/passport-v1.1-spec.md](docs/passport-v1.1-spec.md) (§17 UI complete · §19 passport detail UX · §20 notifications · §21 profile unified) · Ponder reindex: [docs/VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md)

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
- **Ponder RPC (VPS):** `https://sepolia.base.org` — see [VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md) (PublicNode without token returns 403 on archive `eth_getLogs`)
- **Start block:** keep numeric `PONDER_START_BLOCK_84532` after sync — do **not** switch to `latest` on Ponder 0.16 (changes `build_id` → `MigrationError`)
- Deploy workflow: `.github/workflows/deploy-ponder.yml`
- **After `ponder.schema.ts` changes:** run [docs/VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md) on VPS before starting the new image

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
| `GET /passports/batch` | Watchlist + notifications — `fetchPassportBatch` |
| `GET /listings/batch` | Watchlist snapshot diff — `fetchListingBatch` |
| `GET /notifications/:address` | Alerts feed — `fetchNotificationFeed` |
| `GET /profile/:address/passports` | Profile page — `getProfileData` |
| `GET /profile/:address/listings` | Profile, pro showroom — `getProfileData`, `getProShowroomData` |
| `GET /verifiers` | `/verifiers` — `fetchVerifierDirectory` |
| `GET /verifiers/:address` | `/profile/[address]`, pro showroom — `fetchVerifierDetail`, `fetchKarProVerifierProfile`, `getProShowroomData` |
| `GET /verifiers/:address/attestations` | Profile attestations tab, pro showroom — `getVerifierAttestations` |

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
- **Ponder reindex pending** — `disputeOpenedAt` + passport filter columns require VPS reindex before notifications feed and facets are accurate on historical rows.
- **Notifications Phase 2** — `ownedTokenIds: []` for Nostr `#d` subscription (owned passport comments); N+1 record queries in feed builder; tx-level record grouping in UI.
- **Multi-chain indexing** — Ponder today indexes Base Sepolia only; each new chain needs deployment manifest + indexer config (see spec §18).
- **Deferred (Phase 6+):** owner service-history UI, evidence upload on report/clarification forms, full browse N-chain confirm, `GET /passports/:id/trust`, `buyWithUsdc` UI, Playwright browser E2E for passport upload flows.

**Fixed (June 2026):** Profile unified — single `/profile/[handle]` page; `/verifier/[address]` redirects; disputes tab. /verifiers redesign + nav — intent banner, filters, XMTP verification request, shared NOSTR_RELAYS, Verifiers secondary nav button. Marketplace `/` — compact stats above filter bar; VERIFIED listing card border and verifier attribution. `kar-pro-credential-card` showroom link uses `verifierProfile.slug` from Ponder. **Irys:** batch photo upload, devnet gateway routing, IPFS removed from env/code, create/edit upload parity, smart-wallet pre-check. **Passport detail:** identity-first layout, Nostr key hardening (no nsec UI), canonical `shortAddress`, guest-readable comments.

## Future work (multi-chain platform)

| Priority | Task | Notes |
|----------|------|-------|
| **Ops** | Ponder VPS reindex (`disputeOpenedAt` + filter facets) | [runbook](docs/VPS-PONDER-REINDEX.md) |
| **Ops** | Sepolia smoke validation | EOA wallet for Irys; checklist above |
| **Ops** | First KarPro slug via `/kar-pro` stake | Enables `/pro/[slug]` showroom |
| **Chain 1** | Base mainnet (8453) deploy | Same Model X stack; update `deployments/8453.json`, env maps, Irys mainnet node |
| **Chain 2** | Ethereum mainnet (1) | Canonical trust layer; burn/mint bridge — one token on one chain at a time |
| **Indexer** | Per-chain Ponder (or multi-chain config) | Extend `ponder.config.ts` / manifests as networks go live |
| **Storage** | Validate Irys on each new chain | Extend `BASE_CHAIN_IDS` / gateway maps in `irys-client.ts` and `ar-gateway.ts` |
| **QA** | Playwright E2E for notifications + watchlist flows | Alerts inbox, mark read, badge |
| **QA** | Playwright E2E + mock wallet for passport upload | Smart-wallet block message, upload progress, edit metadata-only |
| **Product** | Smart-wallet storage path | Optional server-side or alternative permanent storage if EOA requirement is unacceptable |

## Contributing

This project is MIT licensed. PRs welcome.
Open an issue before starting significant work.

## License

MIT — see [LICENSE](LICENSE).
