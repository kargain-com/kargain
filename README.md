# Kargain

Decentralized peer-to-peer marketplace for used vehicles.
Vehicle history as an NFT passport. Community-driven verification.
Messaging and payments without intermediaries. Including Lightning for verification fees and seller settlement notes.

**Multi-chain platform** — identical Nuclear stacks on Base Sepolia (84532) and Ethereum Sepolia (11155111): KarPassport v1.3, marketplace, auctions, KarPro, and `KarPassportBridgeGateway`. Commerce follows the passport’s custody chain. Mainnet stays gated on the LayerZero Phase 2 checkpoint in [SPEC §7.6](docs/contracts/SPEC.md#76-layerzero-security-configuration-normative).

MIT License · Open Source

---

## What is Kargain?

Kargain combines on-chain vehicle passports, professional verification, and escrow-backed sales:

| Layer | Role |
|-------|------|
| **KarPassport** | Permissionless NFT mint; metadata on Arweave; UNVERIFIED → VERIFIED → DISPUTED lifecycle |
| **KarPro** | Soulbound verifier credential + refundable stake (`KarProStaking`); verification fees (ETH / USDC / Lightning) |
| **MarketplaceEscrow** | Listings in registered fiat codes, native/ERC-20 checkout, agent consignment, external payment confirmation |
| **AuctionEscrow** | English reserve auctions with settlement hold (browse at `/auctions`) |
| **Bridge** | Symmetric `KarPassportBridgeGateway` hub↔spoke (Base Sepolia ↔ Ethereum Sepolia); trust resets on every crossing |
| **Off-chain** | [Ponder](https://ponder.kargain.com) indexer, Nostr (profiles, comments, watchlist, notifications), XMTP messaging, Lightning (LNURL-pay + optional NWC) |

Contract behavior, metadata rules, and addresses: **[docs/contracts/SPEC.md](docs/contracts/SPEC.md)** ([I.9.1](docs/contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) Base Sepolia · [I.9.2](docs/contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) Ethereum Sepolia · multichain [§I.12](docs/contracts/SPEC.md#i12-multi-chain-architecture-normative)).
UI layout: **[docs/design-spec.md](docs/design-spec.md)**.

---

## Documentation

**Start here:** [docs/README.md](docs/README.md)

| Topic | Document |
|-------|----------|
| Contracts, metadata, deploy addresses | [docs/contracts/SPEC.md](docs/contracts/SPEC.md) |
| Ponder indexer (API, ops, v2 reference) | [docs/indexer/README.md](docs/indexer/README.md) |
| VPS reindex runbook | [docs/indexer/OPERATIONS.md](docs/indexer/OPERATIONS.md) |
| Generation v2 deploy (84532) | [docs/ops/deploys/84532-v2.md](docs/ops/deploys/84532-v2.md) |
| Bridge pathway (84532 ↔ 11155111) | [docs/ops/deploys/bridge-84532-11155111.md](docs/ops/deploys/bridge-84532-11155111.md) |
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
| Payments | ETH / USDC on-chain; Lightning (LNURL-pay, NWC); seller settlement notes (bank / BTC / Lightning) |
| Display FX | USD hub + fiat/crypto display currencies (Chainlink + CoinGecko) |
| Chains (today) | Base Sepolia **84532** + Ethereum Sepolia **11155111** (commerce on custody chain; bridge both ways) |

---

## App routes

| Route | Purpose |
|-------|---------|
| `/` | Marketplace browse |
| `/passport/new` | Mint KarPassport |
| `/passport/[tokenId]/edit` | Edit passport metadata |
| `/auctions` | Active auction browse |
| `/marketplace/[tokenId]` | Listing / passport detail (sell, buy, bridge) |
| `/marketplace/[tokenId]/edit` | Seller listing edit |
| `/kar-pro` | KarPro hub (profile, fee, payments, membership, Commons) |
| `/pro/[slug]` | KarPro verifier showroom |
| `/pro/[slug]/consignments` | Public active consignments catalog |
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

Configure `.env.local` from [`.env.example`](.env.example). Contract fallbacks: [`lib/web3/deployment-addresses.ts`](lib/web3/deployment-addresses.ts) / [`lib/web3/commercial-active.ts`](lib/web3/commercial-active.ts) (must match [SPEC I.9.1](docs/contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) and [I.9.2](docs/contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111)). For mobile wallets, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from [WalletConnect Cloud](https://cloud.walletconnect.com). Dual-chain RPC: `NEXT_PUBLIC_RPC_BY_CHAIN` (or `ETH_SEPOLIA_RPC_URL`) must include **11155111**.

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
pnpm deploy:sepolia          # nuclear stack on Base Sepolia (84532)
pnpm deploy:sepolia:eth      # identical nuclear stack on Ethereum Sepolia (11155111)
pnpm deploy:nuclear:dry-run  # print 84532 vs 11155111 parameter parity (no txs)
pnpm deploy:auction          # additive AuctionEscrow (legacy manifests without auction)
pnpm upgrade:auction         # Timelock UUPS upgrade (pass -- --deploy-impl | --schedule | --execute)
pnpm smoke:sepolia
pnpm verify:sepolia          # Basescan best-effort; use --auction-only after auction deploy / upgrade impl
```

After compile: `node scripts/export-abis.mjs`

---

## Production indexer

- API: https://ponder.kargain.com (dual commercial chains; Nuclear hub from block **44434865**, Eth from **11319840**)
- Stack: `docker compose up -d` · diagnostic: `pnpm ponder:config`
- Reindex after schema changes: [docs/indexer/OPERATIONS.md](docs/indexer/OPERATIONS.md)

---

## Known limitations

- **Irys uploads** use the connected wallet for Arweave storage deposits. Photos are re-encoded to WebP (up to 100 KB each) in the browser before upload. Smart contract wallets may still fail when multiple photos require a separate Irys ETH deposit; the app shows a preflight warning on the photo step.
- **Passport bridge** is testnet-scope (84532 ↔ 11155111) until the LayerZero Phase 2 checkpoint in [SPEC §7.6](docs/contracts/SPEC.md#76-layerzero-security-configuration-normative) clears — no mainnet pathway yet.
- **Disputed passports** can still be listed; status is shown in the UI before purchase.

---

## Governance

Protocol standards: [kargain-com/kips](https://github.com/kargain-com/kips) ([KIP-1](https://github.com/kargain-com/kips/blob/master/kip-0001.md)).

## License

MIT — see [LICENSE](LICENSE).
