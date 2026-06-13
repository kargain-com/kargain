# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries.

MIT License · Open Source · Built on Base

---

## How it works

### KarPassport

Anyone can **permissionlessly mint** a KarPassport NFT at [`/passport/new`](/passport/new). Vehicle details and photos are stored on Arweave (via client-side Irys upload). Each passport starts **UNVERIFIED**.

An **active verifier** (address with an active stake in `KarProStaking`, not the token owner) can **verify** the passport on-chain. The owner may update the metadata URI only while status is UNVERIFIED.

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

- **Ponder** indexes contract events and serves listing/passport/verifier APIs ([production](https://ponder.kargain.com)).
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
| Contracts (Model X) | Deployed on Base Sepolia, 64 tests passing |
| Ponder indexer | Configured; production at https://ponder.kargain.com |
| ABIs & addresses | Exported in `lib/contracts/abis.generated.ts`, `lib/web3/deployment-addresses.ts` |
| Irys uploads | Client library integrated |
| **UI on-chain wiring** | **In progress** — wagmi write calls and Ponder-backed views still stubbed |

Remaining UI flows: `becomeVerifier`, `mintPassport`, `verify`, `dispute`, `resolve`, `list`, `delist`, `buy`, `leave`, profiles.

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

Open http://localhost:3000

### Create a passport

Connect a wallet, then visit `/passport/new`. The Irys upload flow is implemented; the on-chain `mintPassport` call is pending UI wiring.

### Contracts (local)

```bash
pnpm hardhat compile    # compile Solidity
pnpm hardhat test       # 64 contract tests (node:test + viem)
pnpm hardhat run scripts/deploy.ts --network baseSepolia   # full Model X deploy
```

After compile, refresh ABIs:

```bash
node scripts/export-abis.mjs
```

---

## Contracts (Base Sepolia)

Network: Base Sepolia (chain **84532**) · Deployed: June 2026 (Model X)

| Contract | Address |
|----------|---------|
| KarProPass | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` |
| KarProStaking | `0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31` |
| KarPassport | `0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083` |
| MarketplaceEscrow (proxy) | `0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F` |
| MarketplaceEscrow (impl) | `0x8888594b12DF2e1EF406e91CFF72d52801BCaC24` |
| Deployer / upgradeAuthority | `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77` |
| platformRecipient | `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` |

### On-chain parameters

| Parameter | Value |
|-----------|-------|
| `minStakeNative` | 0.05 ETH (owner-adjustable; affects new verifiers only) |
| `platformFeeBps` | 10 (0.1%) |
| `proFeeBps` | 0 |
| Payment assets | Native ETH, USDC |

---

## Infrastructure

Production indexer runs on OVH VPS via Docker Compose: **PostgreSQL + Ponder + cloudflared**.

- Ponder API: https://ponder.kargain.com
- RPC: publicnode (`startBlock: latest` in `ponder.config.ts`)
- Deploy workflow: `.github/workflows/deploy-ponder.yml`

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
- Metadata URI is editable by the owner only while status is UNVERIFIED.
- Disputed passports can still be listed and sold; buyers see status in the UI.
- Ponder indexes verifier `metadataURI` from `ProPassMinted` / `ProfileUpdated` and record `description` / `evidenceCID` from `RecordAppended`.

## Known technical debt

- **UI wiring** — wagmi contract writes and Ponder-backed views are stubbed in several components (`TODO Phase 1.1` comments).
- **upgradeAuthority** — currently the deployer EOA, not a timelock.
- **`scripts/deploy-proxy.ts`** — references a stale MarketplaceEscrow impl; use `scripts/deploy.ts` for full Model X deploys.

## Contributing

This project is MIT licensed. PRs welcome.
Open an issue before starting significant work.

## License

MIT — see [LICENSE](LICENSE).
