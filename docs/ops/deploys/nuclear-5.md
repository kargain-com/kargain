# Nuclear #5 — S3.5 prep (84532 + 11155111)

**Status: PREP ONLY** (August 2026). Source + gates on `feat/solana-svm-port` (commits A1→A2→A3→A5). **Not live** — no `COMMERCIAL_ACTIVE` cutover, no VPS reindex, no manifest addresses until founder runbook.

**Local only.** Empty-testnet full redeploy of the commercial stack (same class as Nuclear #4).

**Register:** no PENDING row until cutover planning.  
**Tooling:** `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:*`, `smoke:*`, `bridge:wire*`, `lz:snapshot`, `ponder:config`.  
**Keys:** hardhat/dotenv only — never log secrets.

---

## Role signers (founder — required before live deploy)

| Role | Env var | Address |
|------|---------|---------|
| Fee sink (`platformRecipient`) | `PLATFORM_RECIPIENT` | |
| Forfeit sink (`forfeitRecipient`) | `FORFEIT_RECIPIENT` | |
| Commerce guardian | `COMMERCE_GUARDIAN` | |

Three **distinct** smart-account signers. Dry-run / manifest writers fail closed if any is missing (A1).

---

## What S3.5 source ships (bytecode — not on chain yet)

| Contract | VERSION (source) | Change class |
|----------|-------------------|--------------|
| KarProPass | `1.1.0-rc.1` | Pair with staking |
| KarProStaking | `2.2.0-rc.1` | Native-only join; ERC-20 stake path removed |
| KarPassport | `1.10.0-rc.1` | Unchanged logic; fresh deploy with modes |
| FixedPriceConsignment | `2.4.0-rc.1` | Unchanged logic |
| AscendingConsignment | `2.5.0-rc.1` | Seven auction bounds → bytecode constants; `setChallengeBond` replaces `setAuctionRules`; `AuctionRulesSet` at `initialize` |
| KarPassportBridgeGateway | `1.3.0-rc.1` | Unchanged logic |
| Timelock48h | reuse or redeploy | Prefer existing Timelock if still trusted |

**Deploy wiring (A1):** `platformRecipient` = fee sink only; `forfeitRecipient` → passport ctor + Ascending forfeit slot (distinct from fee).

**Gates before cutover:**

- A1: role manifest parity + `claimable-payouts-sink-gas` (native push vs claim credit)
- A2: Ascending constants + `setChallengeBond`; `auctionRules()` ABI shape preserved
- A3: KarProStaking native-only + retarget-trap test; production `StakeTokenSet` count **0** on both commercial chains (no Ponder handler)
- A5: `test/KarPassportBridgeGateway.test.ts` captures Solidity `send()` bytes (PacketSent or EndpointV2Mock trace); 731-byte URI case

**Out of scope for this prep:** `svm/**`, `COMMERCIAL_ACTIVE` / deployment JSON, VPS reindex, frontend.

---

## Prerequisites (founder cutover — do not run until roles filled)

1. S3.5 branch merged per plan §19 (with SVM port if applicable).  
2. Full gate matrix green (see HANDOFF / AGENTS S3.5 milestone).  
3. `.env.local`: `DEPLOYER_PRIVATE_KEY`, `PLATFORM_RECIPIENT`, `FORFEIT_RECIPIENT`, `COMMERCE_GUARDIAN`.  
4. `pnpm compile`  
5. `pnpm deploy:nuclear:dry-run` exit 0.

---

## Steps (stub — flesh at cutover)

Mirror [nuclear-4.md](./nuclear-4.md) ordering with N5 VERSION read-backs and new Ascending init arity. After deploy: full VPS reindex from new `indexFromBlock` rows + app deploy + smoke `/ready` + `/consignments` + §7.6 wire check.

**Do not** edit this stub with placeholder addresses — founder fills manifest after RPC read-back.
