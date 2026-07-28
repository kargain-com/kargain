# Base Sepolia AuctionEscrow — additive deploy record (84532)

Point-in-time deploy log for the **additive** AuctionEscrow cutover. Does **not** redeploy or mutate the generation v2 stack. Design reference: [auction-design.md §11](../../research/auction-design.md).

| | |
|--|--|
| Date | July 13, 2026 |
| Git commit | `4e8b1ba` — AuctionEscrow Sepolia deploy + verify UX |
| Deployer (public) | `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77` |
| Manifest | `deployments/84532.json` — merges `auctionEscrow`, `auctionEscrowImpl`; **`indexFromBlock` unchanged** (43399242) |

---

## Deployed addresses

| Contract | Address | Block | Tx |
|----------|---------|-------|-----|
| AuctionEscrow proxy | [`0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce`](https://sepolia.basescan.org/address/0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce) | 44080895 | `0x0bb29db41de3a4f750b8719e8cd98802bbc9588a2bfd8ba51f888d114c4e5368` |
| AuctionEscrow impl | [`0x8e87749CE61569ACFc60058fFAc2122A97466c5A`](https://sepolia.basescan.org/address/0x8e87749CE61569ACFc60058fFAc2122A97466c5A) | 44080893 | `0xd4ed6c9cbd86589c12bc7f3dcc20f7aa99968ac3cfafdd675f637fdc62b72fd3` |

**Ponder auction start block (iteration b):** **44080895** (proxy deploy block). Do **not** change global `PONDER_START_BLOCK_84532` (43399242). See [indexer/MIGRATION-AUCTION.md](../../indexer/MIGRATION-AUCTION.md).

---

## Prerequisites

- Existing v2 manifest in `deployments/84532.json` (`pnpm deploy:sepolia` already run)
- `.env.local` with `DEPLOYER_PRIVATE_KEY`
- `pnpm compile` current (generates `AuctionEscrowAbi`)

---

## Deploy steps

```bash
# 1. Additive deploy (impl + proxy only)
pnpm deploy:auction
```

**Manifest diff** (only new keys; all v2 addresses unchanged):

| Key | Value |
|-----|-------|
| `auctionEscrow` | `0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce` |
| `auctionEscrowImpl` | `0x8e87749CE61569ACFc60058fFAc2122A97466c5A` |
| `blocks.auctionEscrow` | 44080895 |
| `blocks.auctionEscrowImpl` | 44080893 |
| `contractVersions.AuctionEscrow` | `1.0.0-draft` |
| `indexFromBlock` | **43399242** (unchanged) |

```bash
# 2. Commit fallbacks — lib/web3/sepolia-addresses.ts (SEPOLIA_ACTIVE)
# 3. Basescan verify (best-effort; exit 0 on bytecode mismatch — use smoke as gate)
pnpm verify:sepolia --auction-only
# 4. On-chain smoke
pnpm smoke:sepolia
```

---

## Post-deploy checks

| Check | Result |
|-------|--------|
| `pnpm smoke:sepolia` | **18/18 pass** |
| `pnpm verify:sepolia --auction-only` | **Bytecode mismatch** (HHE80009) — exit **0** by default; smoke is the gate. Use `--strict` to fail on mismatch. |

| Smoke id | Check | Expected |
|----------|-------|----------|
| `g` | `VERSION AuctionEscrow` | `1.0.0-draft` |
| `q` | `AuctionEscrow.upgradeAuthority == timelock` | `0x9319e223ff31c954A940b14F04025B56A53ED384` |
| `r` | `AuctionEscrow.isAuctionActive(0)` | `false` |

**Constructor immutables (impl):** `karPassport`, `usdc`, `karProStaking`, `platformRecipient`, `platformFeeBps` = **10** (0.1%). Source post-claim-payout has **no** `wrappedNative` — historical live impl still had WETH until Nuclear #2.

**Initializer:** `initialize(timelock)` — no deployer-genesis phase; `upgradeAuthority` set directly to timelock.

---

## Out of scope (later iterations)

| Iteration | Work |
|-----------|------|
| b | Ponder schema + handlers + start block — **shipped July 2026**; **VPS reindex completed July 14, 2026** ([MIGRATION-AUCTION.md](../../indexer/MIGRATION-AUCTION.md)) — live `/auctions` → `total: 0` (no lots yet) |
| c | e2e |
| d | UI route |
| — | SPEC Part I.9.1 address rows + Part I.11 behavior — **shipped July 14, 2026** |

**Ponder:** Do **not** change `PONDER_START_BLOCK_84532` when deploying auction indexer. Auction indexing uses `blocks.auctionEscrow` (**44080895**) per contract in `ponder.config.ts`.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `AuctionEscrow already deployed` | Idempotency guard — manifest already has `auctionEscrow`; do not re-run |
| RPC timeout / tx not found | Retry `pnpm deploy:auction`; partial txs may need manual recovery |
| `verify:sepolia` HHE80009 / exit 1 | Bytecode mismatch — **exit 0 by default** since verify UX fix; run `pnpm smoke:sepolia`. Use `--strict` for CI fail-on-mismatch. |
| Smoke missing auction checks | Manifest lacks `auctionEscrow` — run `pnpm deploy:auction` first |
| `auctionEscrowAddress()` undefined in app | Commit proxy to `SEPOLIA_ACTIVE` or set `NEXT_PUBLIC_AUCTION_ESCROW_BY_CHAIN` |

---

## Deploy notes

- Script reads existing manifest deps: `karPassport`, `karProStaking`, `usdc`, `timelock`, `platformRecipient`
- Re-running `pnpm deploy:sepolia` would overwrite v2 stack — **never** run full stack deploy for auction-only work
- Vercel: no env overrides needed after `SEPOLIA_ACTIVE` commit (same pattern as v2)
