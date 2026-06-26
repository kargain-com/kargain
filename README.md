# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries.

**Multi-chain platform** — Kargain is designed to run on multiple networks, not a single L2. **Base Sepolia** is the current **integration testnet**; Base mainnet and additional chains follow validation.

MIT License · Open Source

---

## Multi-chain platform

| | |
|---|---|
| **Vision** | One marketplace and passport protocol across chains. Users choose where their passport lives; listings and trust state are chain-scoped but the product is not. |
| **Today** | **Base Sepolia (84532)** — contracts, Ponder indexer, and integration testing. Optional **Hardhat (31337)** for local development. |
| **Planned** | **Base mainnet (8453)**, then **Ethereum mainnet (1)** as canonical trust layer. |
| **Chain-agnostic** | Passport photos and metadata on **Arweave**; Nostr comments, watchlist, and notifications; XMTP messaging. |

Contract addresses and RPC configuration are parameterized per chain via `deployments/<chainId>.json` and `lib/web3/deployment-addresses.ts`.

---

## How it works

### KarPassport

Anyone can **permissionlessly mint** a KarPassport NFT at [`/passport/new`](/passport/new). Vehicle details and photos are stored on Arweave (via client-side Irys upload). Each passport starts **UNVERIFIED**.

An **active verifier** (address with an active stake in `KarProStaking`, not the token owner) can **verify** the passport on-chain. The owner may update metadata while **UNVERIFIED**, or while **VERIFIED** — anchor field changes reset verification (Variant C); cosmetic-only edits keep verified status.

Anyone may **dispute** a verified passport. An active verifier **resolves** disputes: uphold keeps VERIFIED status; reject clears verification and returns the passport to UNVERIFIED. Owners and third parties can append **rich on-chain records** (service history, discrepancies, attestations).

### KarProPass & KarProStaking (Model X)

Soulbound credential for verification professionals — **one pass per wallet**, non-transferable.

Becoming a verifier is a **single permissionless action**: stake **0.05 ETH** via `KarProStaking.becomeVerifierNative` → receive a KarProPass. **Active stake** (`isActiveVerifier`) is the source of truth for verifier status — not KarProPass balance. Stake is **fully refundable** — no slash, no delay. `leave()` burns the pass and returns the stake.

Verifier identity (category, display name, metadata URI) is stored on-chain and indexed by Ponder. Kargain revenue comes **only from marketplace sales** (0.1% platform fee).

Verifier categories: `MECHANIC` · `GARAGE` · `INSPECTOR` · `BROKER` · `DEALER` · `OTHER`

### MarketplaceEscrow

UUPS-upgradeable escrow. Sellers list KarPassport NFTs with a **fiat price** (USD or EUR, stored 1e8). Buyers pay the on-chain quote via **native ETH** or **USDC**, priced through **Chainlink** feeds. Platform fee: **0.1%** (`platformFeeBps: 10`). Passport verification status does not block listing or purchase — transparency is enforced in the UI.

### Off-chain layers

- **Ponder** — indexes contract events and serves listing, passport, and verifier APIs ([production](https://ponder.kargain.com)).
- **Nostr** — public comments (NIP-01), watchlist (NIP-51), notification read-state (NIP-78). Wallet-derived identity.
- **XMTP** — encrypted buyer–seller messaging.

---

## Architecture

| Layer | Role |
|-------|------|
| **Next.js frontend** | App UI, wallet auth (SIWE), client-side Arweave uploads |
| **Ponder indexer** | Indexes chain events; REST API for listings, passports, verifiers |
| **EVM contracts** | KarPassport, KarProPass, KarProStaking (immutable); MarketplaceEscrow (UUPS proxy) |
| **Arweave** (via Irys) | Permanent photos and passport metadata (`ar://` URIs) |
| **Nostr** | Comments, watchlist, notification sync |
| **XMTP** | End-to-end encrypted messaging |

**Documentation:** [passport-v1.1-spec.md](docs/passport-v1.1-spec.md) (contract spec) · [design-spec.md](docs/design-spec.md) (UI patterns) · [VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md) (indexer reindex runbook)

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind v4, wagmi 2, viem |
| Indexer | Ponder 0.16, PostgreSQL |
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 |
| Storage | Arweave via Irys (`@irys/web-upload`) |
| Social | Nostr (NIP-01, NIP-51, NIP-78) |
| Messaging | XMTP |
| Chain | Base Sepolia (84532) testnet today; multi-chain by design |

## App routes

| Route | Purpose |
|-------|---------|
| `/` | Marketplace browse — filters and listings |
| `/passport/new` | Mint KarPassport |
| `/passport/[tokenId]/edit` | Edit passport metadata |
| `/marketplace/[tokenId]` | Listing / passport detail |
| `/marketplace/[tokenId]/edit` | Seller listing edit |
| `/kar-pro` | KarPro onboarding and credential |
| `/verifiers` | Verifier directory |
| `/verifier/[address]` | Redirects to `/profile/[address]` |
| `/pro/[slug]` | Professional showroom |
| `/profile/[handle]` | Public wallet profile |
| `/profile/edit` | Profile edit and wallet connect |
| `/messages` | XMTP inbox |
| `/messages/[conversationId]` | DM thread |
| `/notifications` | Alerts and watchlist (`?tab=watchlist`) |

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

Full Model X stack on a persistent Hardhat node with Ponder indexing:

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

Connect a wallet, then visit `/passport/new`. Photos and metadata upload via Irys (client-side, user-pays). **Standard EOA wallets** are required for upload — smart contract accounts are blocked before any Irys transaction.

### Tests and contracts

```bash
pnpm hardhat compile    # compile Solidity
pnpm hardhat test       # contract tests
pnpm test:e2e           # localhost lifecycle (requires hardhat node + deploy:local)
pnpm deploy:local       # deploy Model X to running Hardhat node
pnpm deploy:v1.1        # partial redeploy (KarPassport + Marketplace on Sepolia)
pnpm verify:v1.1        # verify on Basescan (needs ETHERSCAN_API_KEY)
pnpm deploy:base-sepolia # full Model X greenfield deploy on Sepolia
node --import tsx --test test/*.test.ts   # app unit tests
```

After compile, refresh ABIs: `node scripts/export-abis.mjs`

---

## Contracts (Base Sepolia — testnet)

Network: Base Sepolia (chain **84532**)

| Contract | Address |
|----------|---------|
| KarProPass | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` |
| KarProStaking | `0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31` |
| KarPassport (v1.1) | `0x6378469256907D7DC14BBfce0261ceDE22314507` |
| MarketplaceEscrow (proxy) | `0x4FC74e0B7eE0A741707A553D43Efff68126D198B` |
| MarketplaceEscrow (impl) | `0x7d37e7cbcc42308264B608429a82D03B7C3112F4` |

Verified on [Base Sepolia Basescan](https://sepolia.basescan.org). Full addresses and parameters: [passport-v1.1-spec.md](docs/passport-v1.1-spec.md).

| Parameter | Value |
|-----------|-------|
| `minStakeNative` | 0.05 ETH |
| `platformFeeBps` | 10 (0.1%) |
| Payment assets | Native ETH, USDC |
| Deployer EOA | `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77` |
| Marketplace `upgradeAuthority` | Same as deployer (no timelock on testnet) — [spec §13.1](docs/passport-v1.1-spec.md) |

---

## Infrastructure

Production indexer: **PostgreSQL + Ponder + cloudflared**

- Ponder API: https://ponder.kargain.com
- Local stack: `docker compose up -d`
- Schema changes require reindex — see [VPS-PONDER-REINDEX.md](docs/VPS-PONDER-REINDEX.md)

---

## Ponder API

| Endpoint | Purpose |
|----------|---------|
| `GET /listings` | Marketplace browse and search (optional: `priceCurrency`, `eurUsdRate`, `ethUsdRate` for cross-currency filter/sort). Unfiltered default browse uses SQL pagination in Ponder (not full-table scan). |
| `GET /listings/facets` | Filter facets (make, price, status, …) |
| `GET /listings/:tokenId` | Listing detail |
| `GET /passports/:tokenId` | Passport detail |
| `GET /passports/batch` | Batch passport lookup |
| `GET /listings/batch` | Batch listing lookup |
| `GET /notifications/:address` | Alerts feed for a wallet |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /profile/:address/listings` | Listings by seller |
| `GET /verifiers` | Verifier directory |
| `GET /verifiers/:address` | Verifier profile |
| `GET /verifiers/:address/attestations` | Verifier attestations |

---

## Known limitations

- **Smart wallets + Irys** — contract accounts and EIP-7702 wallets cannot fund Irys uploads from the browser. Use a standard EOA on the target chain for passport photo upload.
- **Multi-chain** — Ponder indexes Base Sepolia today; additional chains require deployment and indexer configuration per network.
- **Verification transparency** — disputed passports can still be listed; buyers see status in the UI before purchase.
- **Upgrade authority** — On Base Sepolia, `MarketplaceEscrow.upgradeAuthority` is the deployer EOA, not a `TimelockController` (see [passport-v1.1-spec §13.1](docs/passport-v1.1-spec.md)). Localhost uses a real timelock contract.

---

## Governance and proposals

Protocol standards and process live in a separate repo:
[kargain-com/kips](https://github.com/kargain-com/kips).

| Change type | Where to start |
|-------------|----------------|
| Protocol / standard (metadata, staking rules, interoperability) | Read [KIP-1](https://github.com/kargain-com/kips/blob/master/kip-0001.md), then open a PR in `kips` |
| App code (UI, indexer consumer, contracts in this repo) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Contract behavior (implemented today) | [passport-v1.1-spec.md](docs/passport-v1.1-spec.md) |
| UI layout and tokens | [design-spec.md](docs/design-spec.md) |

---

## Contributing

This project is MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, scope, and the KIP vs code split.
Open an issue before significant work.

## License

MIT — see [LICENSE](LICENSE).
