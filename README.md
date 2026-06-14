# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries.

MIT License · Open Source · Built on Base

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
| **Ponder indexer** | Indexes Base Sepolia events; REST API (`/listings`, `/passports`, `/verifiers`, …) |
| **Base L2 contracts** | KarPassport, KarProPass, KarProStaking (immutable); MarketplaceEscrow (UUPS proxy) |
| **Arweave** (via Irys) | Permanent photos and passport metadata |
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
| Chain | Base Sepolia (testnet) — mainnet after Sepolia validation |

## Phase status (June 2026)

| Area | Status |
|------|--------|
| **KarPassport v1.1 (Phases 1–5)** | **Complete** — merged to `master` |
| **Trust / UX gap (plan A–J core)** | **Complete** — BuyRiskModal, verifier badges, G1/G2 Ponder, metadata diff, DISPUTED filter |
| **Phase 5 polish (PR5a–d)** | **Complete** — typed record timeline, attestation UI, browse chain-status warning, Basescan verify |
| Contracts (Model X) | v1.1 on Base Sepolia; verified on [Basescan](https://sepolia.basescan.org); Hardhat + T10/E5 matrix |
| Ponder indexer | Production at https://ponder.kargain.com — **reindex required after G1 schema** ([runbook](docs/VPS-PONDER-REINDEX.md)) |
| ABIs & addresses | `lib/web3/deployment-addresses.ts` + `deployments/84532.json` manifest |
| Passport UI | Mint, edit (Variant C), verify/dispute/resolve, verifier attestation, typed records timeline, marketplace trust gates, Kar Pro, profiles |
| Browse UX | Server-side filters (fuel/body/trans/status); sample on-chain status confirm on listing cards (G4) |
| Local E2E (31337) | `pnpm deploy:local`, `pnpm test:e2e`, `./scripts/dev-local.sh` |

**Tests:** `pnpm hardhat test` · `pnpm test:metadata` · `pnpm test:listing` · `pnpm test:ponder` · `pnpm test:trust` · `pnpm test:records` · `pnpm test:confirm-status` · `pnpm test:verify` · `pnpm test:e2e`

Spec: [docs/passport-v1.1-spec.md](docs/passport-v1.1-spec.md) · Ponder reindex: [docs/VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md)

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
| `NEXT_PUBLIC_CHAIN_ID` | Default chain — `84532` for Base Sepolia |
| `NEXT_PUBLIC_XMTP_ENV` | XMTP environment — `dev` or `production` |
| `NEXT_PUBLIC_RPC_BY_CHAIN` | JSON map of chain ID → RPC URL |
| `NEXT_PUBLIC_IRYS_NODE_URL` | Irys node for client-side Arweave uploads |
| `PONDER_SQL_API_URL` | Ponder REST API (local: `http://localhost:42069`) |
| `IPFS_GATEWAY_URL` | HTTP gateway for resolving `ipfs://` URIs in metadata |
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

## Contracts (Base Sepolia)

Network: Base Sepolia (chain **84532**) · v1.1 partial redeploy: June 2026

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

| Endpoint | Description |
|----------|-------------|
| `GET /listings` | Active marketplace listings (paginated) |
| `GET /listings/facets` | Filter facets (fiat currencies) |
| `GET /listings/:tokenId` | Single listing |
| `GET /passports` | Passports (filter by owner, status) |
| `GET /passports/:tokenId` | Single passport |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /profile/:address/listings` | Listings by seller |
| `GET /verifiers` | Active verifiers |
| `GET /verifiers/:address` | Verifier profile + verification count |

---

## Architecture notes

- **VIN** and vehicle attributes live in Arweave metadata (not on-chain).
- Metadata URI is editable by the owner when **UNVERIFIED**, or when **VERIFIED** if only cosmetic fields change; anchor edits emit `VerificationReset` and return the passport to **UNVERIFIED** (Variant C).
- Disputed passports can still be listed and sold; buyers see status in the UI (including buy-risk modal and typed dispute timeline).
- Passport detail confirms on-chain status when it differs from Ponder; marketplace browse samples up to 12 visible cards per page.
- Ponder indexes verifier `metadataURI` from `ProPassMinted` / `ProfileUpdated` and record `description` / `evidenceCID` from `RecordAppended`.

## Known technical debt

- **upgradeAuthority** — currently the deployer EOA, not a timelock.
- **`scripts/deploy-proxy.ts`** — references a stale MarketplaceEscrow impl; use `pnpm deploy:v1.1` or `pnpm deploy:base-sepolia`.
- **`ProPassBurned`** — does not snapshot verifier profile (live state only).
- **Deferred (Phase 6+):** owner service-history UI, evidence upload on report/clarification forms, full browse N-chain confirm, `GET /passports/:id/trust`, `buyWithUsdc` UI.

## Contributing

This project is MIT licensed. PRs welcome.
Open an issue before starting significant work.

## License

MIT — see [LICENSE](LICENSE).
