# Base Sepolia AuctionEscrow — Timelock UUPS upgrade to 1.0.1-draft (84532)

Maintainer rehearsal: first `Timelock48h`-gated UUPS upgrade of AuctionEscrow. **Cursor never runs live txs** — use this runbook.

| | |
|--|--|
| Target VERSION | `1.0.1-draft` (`NotBuyer` / `AuctionSettleable`) |
| Proxy (unchanged) | [`0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce`](https://sepolia.basescan.org/address/0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce) |
| Live impl before upgrade | [`0x8e87749CE61569ACFc60058fFAc2122A97466c5A`](https://sepolia.basescan.org/address/0x8e87749CE61569ACFc60058fFAc2122A97466c5A) (`1.0.0-draft`) |
| Timelock (`upgradeAuthority`) | [`0x9319e223ff31c954A940b14F04025B56A53ED384`](https://sepolia.basescan.org/address/0x9319e223ff31c954A940b14F04025B56A53ED384) — deployer is sole proposer + executor; **48h** min delay |
| Script | `pnpm upgrade:auction` → [`scripts/upgrade-auction.ts`](../../../scripts/upgrade-auction.ts) (`HARDHAT_NETWORK=baseSepolia node --import tsx`; pass `-- --deploy-impl` etc.) |
| Pending file (local, gitignored) | `deployments/84532.pending-auction-impl.json` |

**Unchanged after upgrade:** proxy address, app/`SEPOLIA_ACTIVE` proxy row, Ponder addresses, indexer start block. **No reindex** (events unchanged). Only the implementation behind the proxy and the manifest `auctionEscrowImpl` / `contractVersions.AuctionEscrow` change.

---

## Prerequisites

- `deployments/84532.json` with `auctionEscrow` (from additive deploy)
- `.env.local` with `DEPLOYER_PRIVATE_KEY` (proposer/executor EOA)
- `pnpm compile` so ABIs match source `1.0.1-draft`
- Confirm on-chain proxy `VERSION()` is still `1.0.0-draft` before starting

---

## Salt scheme (deterministic)

```text
keccak256(toBytes(
  `kargain:84532:AuctionEscrow:upgradeToAndCall:${proxyLower}:${implLower}:1.0.1-draft`
))
```

Calldata: `upgradeToAndCall(newImpl, 0x)` against the proxy. Predecessor: `bytes32(0)`. Delay: `timelock.getMinDelay()` (48h).

---

## Maintainer steps (order)

### 1. Deploy new implementation

```bash
pnpm upgrade:auction -- --deploy-impl
```

- Guards: chain 84532; manifest has `auctionEscrow`; proxy `VERSION()` ≠ target (idempotent exit if already upgraded); pending file reuse if matching.
- Writes **only** `deployments/84532.pending-auction-impl.json` — **does not** update the manifest.
- Record the printed impl address.

### 2. Verify new impl on Basescan

```bash
pnpm verify:sepolia --auction-only
```

`verify.ts` prefers the pending-file impl address when present (proxy still from manifest). Best-effort; HHE80009 → exit 0 by default. Smoke is the post-execute gate.

### 3. Schedule Timelock operation

```bash
pnpm upgrade:auction -- --schedule
```

- Prints **operation id** + **ETA** (unix + UTC). Save them.
- Enriches the pending file with `salt`, `operationId`, `eta`.
- Idempotent if the op is already Waiting/Ready.

### 4. Wait 48h

Do not call `--execute` before ETA. Re-running `--schedule` is safe (prints existing ETA).

### 5. Execute

```bash
pnpm upgrade:auction -- --execute
```

- Asserts proxy `VERSION() === 1.0.1-draft` and `upgradeAuthority()` still the timelock.
- Merges manifest: `auctionEscrowImpl`, `blocks.auctionEscrowImpl`, `txHashes.auctionEscrowImpl`, `contractVersions.AuctionEscrow`.
- Deletes the pending file.
- Preserves `indexFromBlock` and the proxy address.

### 6. Smoke

```bash
pnpm smoke:sepolia
```

Expect AuctionEscrow VERSION check (`g`) → `1.0.1-draft`; authority / `isAuctionActive(0)` still green.

### 7. Post-execute doc updates (after smoke green)

1. [`docs/contracts/SPEC.md`](../../contracts/SPEC.md) **I.9.1** — replace AuctionEscrow **impl** row address + version with the new impl (`1.0.1-draft`). Proxy row stays the same address; bump its version label to `1.0.1-draft` if you document live VERSION.
2. SPEC **I.1** matrix — drop the parenthetical note that 84532 still runs `1.0.0-draft` (source and live now match).
3. Optional: fill the “Live result” table below on this runbook with commit, impl address, op id, execute tx.

---

## Live result (fill after execute)

| | |
|--|--|
| Date | July 14, 2026 (impl + schedule); July 18, 2026 (execute + manifest merge) |
| Git commit (wiring) | `f1e7896` (+ Hardhat-3 argv / ETA fixes) |
| New impl | [`0x7aCED69A61d77C208140107E2b46d3D7d7266a66`](https://sepolia.basescan.org/address/0x7aCED69A61d77C208140107E2b46d3D7d7266a66) |
| Impl block / tx | **44127565** / `0x9736d227de595e13534af13dc8c258c35714c6b4d1bd7e1fa5442e4540a1086a` |
| Timelock operation id | `0x9ec869f9e3ef0b5e7c266e93501b5bc9c9ce5f3549b65acc53e62c1d3f37dd81` |
| Schedule tx | `0x907e68ee166972cbb18e71842d6f293a8b3244cd5d5beb8d526041a012cf20be` (block 44127590) |
| ETA | **1784196268** → `2026-07-16T10:04:28.000Z` (48h) |
| Execute tx | `0x54292ad9c824f14f2558fbf26de1a06b18126e615f1df8ef7821965ee0d2d436` (block **44293417**) — first `--execute` hit stale VERSION read; re-run merged manifest |
| `pnpm smoke:sepolia` | **18/18** (`VERSION` `1.0.1-draft`) |

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| Schedule / execute “too early” | Wait until ETA; `--schedule` re-prints timestamp |
| Execute before ETA | Script aborts with Waiting + ETA — wait and retry `--execute` |
| VERSION mismatch on new impl | Source/ABI out of date — `pnpm compile`, check `CONTRACT_VERSIONS.AuctionEscrow` |
| Proxy already `1.0.1-draft` mid-flow | `--deploy-impl` / `--schedule` no-op; `--execute` merges manifest + clears pending |
| Stale pending file | Confirm no Waiting/Ready op for the salt; delete `84532.pending-auction-impl.json`; re-run `--deploy-impl` |
| `verify:sepolia` still hits old impl | Pending file missing — re-run `--deploy-impl` or check path |
| Smoke fails VERSION after execute | Upgrade did not land — check execute receipt / impl pointer on Basescan |
| Post-execute VERSION still old, then smoke passes | Stale RPC after execute — re-run `--execute` to merge manifest (idempotent when proxy already new) |

---

## Out of scope

- App / `SEPOLIA_ACTIVE` proxy address (unchanged)
- Ponder reindex or start-block changes
- Multichain rollout (this is the 84532 rehearsal)
