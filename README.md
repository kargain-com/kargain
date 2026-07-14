# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries.

**Multi-chain platform** — Base Sepolia (84532) is the current integration testnet; Base mainnet and additional chains follow validation.

MIT License · Open Source

---

## What is Kargain?

Kargain combines on-chain vehicle passports, professional verification, and escrow-backed sales:

| Layer | Role |
|-------|------|
| **KarPassport** | Permissionless NFT mint; metadata on Arweave; UNVERIFIED → VERIFIED → DISPUTED lifecycle |
| **KarPro** | Soulbound verifier credential + refundable stake (`KarProStaking`) |
| **MarketplaceEscrow** | Listings in registered fiat codes, native/ERC-20 checkout, agent consignment, external payment confirmation |
| **Off-chain** | [Ponder](https://ponder.kargain.com) indexer, Nostr (comments, watchlist, notifications), XMTP messaging |

Contract behavior, metadata rules, and addresses: **[docs/contracts/SPEC.md](docs/contracts/SPEC.md)**.  
UI layout: **[docs/design-spec.md](docs/design-spec.md)**.

---

## Documentation

**Start here:** [docs/README.md](docs/README.md)

| Topic | Document |
|-------|----------|
| Contracts, metadata, deploy addresses | [docs/contracts/SPEC.md](docs/contracts/SPEC.md) |
| Ponder indexer (API, ops, v2 reference) | [docs/indexer/README.md](docs/indexer/README.md) |
| VPS reindex runbook | [docs/indexer/OPERATIONS.md](docs/indexer/OPERATIONS.md) |
| June 2026 v2 deploy record | [docs/ops/deploys/84532-v2.md](docs/ops/deploys/84532-v2.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind v4, wagmi 2, viem |
| Indexer | Ponder 0.16, PostgreSQL |
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 |
| Storage | Arweave via Irys |
| Social / messaging | Nostr (NIP-01, NIP-51, NIP-78), XMTP |
| Chain (today) | Base Sepolia (84532) |

---

## App routes

| Route | Purpose |
|-------|---------|
| `/` | Marketplace browse |
| `/passport/new` | Mint KarPassport |
| `/passport/[tokenId]/edit` | Edit passport metadata |
| `/auctions` | Active auction browse |
| `/marketplace/[tokenId]` | Listing / passport detail |
| `/marketplace/[tokenId]/edit` | Seller listing edit |
| `/kar-pro` | KarPro onboarding |
| `/verifiers` | Verifier directory |
| `/profile/[handle]` | Public profile |
| `/about` | Product overview (public prose) |
| `/messages`, `/notifications` | XMTP inbox, alerts + watchlist |

---

## Development setup

### Prerequisites

- Node.js 20+, pnpm
- Base Sepolia ETH for on-chain testing — [faucet](https://faucet.quicknode.com/base/sepolia)

### Install and run

```bash
git clone https://github.com/kargain-com/kargain.git
cd kargain
pnpm install
cp .env.example .env.local
pnpm dev                    # Next.js → http://localhost:3000
pnpm ponder:dev             # Ponder → http://localhost:42069 (needs Postgres)
```

Configure `.env.local` from [`.env.example`](.env.example). Contract fallbacks: [`lib/web3/deployment-addresses.ts`](lib/web3/deployment-addresses.ts) (must match [SPEC Part I.9.1](docs/contracts/SPEC.md#i91-active-deployment-base-sepolia-84532)). For mobile wallets in Safari/Chrome, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from [WalletConnect Cloud](https://cloud.walletconnect.com).

### Local chain (31337)

```bash
./scripts/dev-local.sh       # Postgres + Hardhat + deploy + Ponder
export NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=1 NEXT_PUBLIC_CHAIN_ID=31337
eval "$(node --import tsx scripts/lib/print-local-env.ts)"
pnpm dev
```

Details: [SPEC Appendix A — local E2E](docs/contracts/SPEC.md#appendix-a--local-e2e-hardhat-31337).

### Tests

```bash
pnpm hardhat test
pnpm test:e2e
node --import tsx --test test/*.test.ts
pnpm deploy:sepolia          # generation v2 on Base Sepolia
pnpm deploy:auction          # additive AuctionEscrow (after v2 manifest exists)
pnpm upgrade:auction         # Timelock UUPS upgrade (-- --deploy-impl | --schedule | --execute)
pnpm smoke:sepolia
pnpm verify:sepolia          # Basescan best-effort; use --auction-only after auction deploy / upgrade impl
```

After compile: `node scripts/export-abis.mjs`

---

## Production indexer

- API: https://ponder.kargain.com (generation v2, from block **43399242**)
- Stack: `docker compose up -d` · diagnostic: `pnpm ponder:config`
- Reindex after schema changes: [docs/indexer/OPERATIONS.md](docs/indexer/OPERATIONS.md)

---

## Known limitations

- **Irys uploads** use the connected wallet for Arweave storage deposits. Photos are re-encoded to WebP (up to 100 KB each) in the browser before upload. Smart contract wallets may still fail when multiple photos require a separate Irys ETH deposit; the app shows a preflight warning on the photo step.
- **Ponder** indexes Base Sepolia today; other chains need per-network deploy + indexer config.
- **Disputed passports** can still be listed; status is shown in the UI before purchase.

---

## Governance

Protocol standards: [kargain-com/kips](https://github.com/kargain-com/kips) ([KIP-1](https://github.com/kargain-com/kips/blob/master/kip-0001.md)).

## License

MIT — see [LICENSE](LICENSE).
