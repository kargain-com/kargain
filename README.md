# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries.

MIT License · Open Source · Built on Base

---

## How it works

### KarPassport

Anyone can **permissionlessly mint** a KarPassport NFT at [`/passport/new`](/passport/new). Vehicle details and photos are stored on Arweave (via client-side Irys upload). Each passport starts **UNVERIFIED**.

A **KarProPass holder** (not the token owner) can **verify** the passport on-chain. The owner may update the metadata URI only while status is UNVERIFIED.

Anyone may **dispute** a verified passport. A KarProPass holder **resolves** disputes: uphold keeps VERIFIED status; reject clears verification and returns the passport to UNVERIFIED. Owners and third parties can append **rich on-chain records** (service history, discrepancies, attestations).

### KarProPass

Soulbound credential for verification professionals — **one pass per wallet**, non-transferable.

- **Phase 1:** contract owner issues passes manually (`ownerMint` / `ownerBurn`).

KarProPass holders verify passports, resolve disputes, and append attestations.

### MarketplaceEscrow

UUPS-upgradeable escrow (timelock-gated upgrades). Sellers list KarPassport NFTs with a **fiat price** (USD or EUR, stored 1e8). Buyers pay the on-chain quote via **native ETH** or **USDC**, priced through **Chainlink** feeds. Sellers who hold a KarProPass pay a **reduced platform fee** (`proFeeBps` vs `platformFeeBps`). Passport verification status does not block listing or purchase — transparency is enforced in the UI.

### Off-chain layers

- **Ponder** (when rebuilt) indexes contract events and enriches listings from Arweave metadata for search and filters.
- **Nostr** powers public comments and garage favorites (NIP-51).
- **XMTP** provides encrypted buyer–seller messaging.

---

## Architecture

| Layer | Role |
|-------|------|
| **Next.js frontend** | App UI, wallet auth (SIWE), client-side Arweave uploads |
| **Ponder indexer** (planned) | Indexes Base contract events; serves listings API (`/listings`, `/listings/facets`) |
| **Base L2 contracts** | KarPassport (immutable), KarProPass (immutable), MarketplaceEscrow (UUPS proxy) |
| **Arweave** (via Irys) | Permanent photos and passport metadata |
| **Nostr** | Public comments (NIP-01), favorites (NIP-51) |
| **XMTP** | End-to-end encrypted buyer–seller messaging |

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind v4, wagmi 2, viem |
| Indexer | Ponder 0.16 (stub — rebuild in progress) |
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 |
| Storage | Arweave via Irys (client upload) |
| Social | Nostr (NIP-01, NIP-02, NIP-51) |
| Messaging | XMTP |
| Chain | Base Sepolia (testnet) — mainnet after Sepolia validation |

## UI shell

| Area | Implementation |
|------|----------------|
| Top nav | Sticky bar — logo, chain selector (Base Sepolia), wallet menu, Messages inbox |
| Mobile nav | Bottom tabs: Marketplace · Messages · FAB (`/passport/new`) · Profile |
| Logo | `components/ui/kargain-logo.tsx` → `/kargain-logo.svg` |
| Marketplace filters | URL-synced filters; Ponder-backed search when indexer is live |

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
| `IPFS_GATEWAY_URL` | HTTP gateway for resolving `ipfs://` URIs in metadata |
| `BASE_SEPOLIA_RPC_URL` | RPC for Hardhat `baseSepolia` network |
| `DEPLOYER_PRIVATE_KEY` | Optional — Hardhat deploy account (never commit) |
| `ETHERSCAN_API_KEY` | Basescan API key for contract verification |

Contract deployment addresses are not configured yet. After deploy, populate `lib/web3/deployment-addresses.ts` and optional `NEXT_PUBLIC_*` overrides.

### Run

```bash
# Next.js frontend (primary dev workflow today)
pnpm dev
```

Open http://localhost:3000

Ponder (`pnpm ponder:dev`) requires a rebuilt indexer config and schema — not operational until Phase 1.1 wiring is complete.

### Create a passport

Connect a wallet, then visit `/passport/new`. Minting and upload flows are stubbed until client Irys upload and contract addresses are wired.

### Contracts (local)

```bash
pnpm hardhat compile    # compile Solidity
pnpm hardhat test       # 65 contract tests (node:test + viem)
```

---

## Contracts (Base Sepolia)

Contracts will be deployed to Base Sepolia before public launch. Addresses will be published here after deployment.

| Contract | Notes |
|----------|-------|
| KarPassport | Immutable ERC-721 with verification lifecycle |
| KarProPass | Soulbound verifier credential (KPP) |
| MarketplaceEscrow | UUPS proxy; Chainlink fiat quotes; native + USDC settlement |

---

## Architecture notes

- **VIN** and vehicle attributes live in Arweave metadata (not on-chain).
- Metadata URI is editable by the owner only while status is UNVERIFIED.
- Disputed passports can still be listed and sold; buyers see status in the UI.

## Known technical debt

- **App wiring** — ABIs, deployment addresses, and wagmi contract calls are stubbed (`TODO Phase 1.1`).
- **Ponder indexer** — deleted during blank-slate cleanup; must be rebuilt for new contract events and schema.
- **Client uploads** — `@irys/web-upload` not yet integrated; passport and avatar flows are disabled.
- **ABI export** — `scripts/export-abis.mjs` is a stub; run after restoring post-compile export.

## Contributing

This project is MIT licensed. PRs welcome.
Open an issue before starting significant work.

## License

MIT — see [LICENSE](LICENSE).
