# Ponder indexer documentation

| Document | Lifecycle | You need it when… |
|----------|-----------|-------------------|
| [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | **Reference** | Deferred marketplace events, FX display extension |
| [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | **Per deploy** | June 2026 v2 deploy + VPS cutover record |

**Production (June 2026):** [ponder.kargain.com](https://ponder.kargain.com) indexes generation v2 contracts from block **43399242** with v2 event handlers. **Reindex required** after deploying handler/schema changes.

## Contract addresses for indexer

Do **not** copy address tables here. Resolution order:

- Committed: `lib/web3/sepolia-addresses.ts` (`SEPOLIA_ACTIVE`) — **VPS uses this after `git pull`**
- Local manifest: `deployments/84532.json` (not in git — deploy machine only until PR merges)
- Diagnostic: `pnpm ponder:config`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532)

**Start block:** `PONDER_START_BLOCK_84532=43399242` (`SEPOLIA_ACTIVE.indexFromBlock`).

## Listing API fields (v2)

Ponder stores `currencyCode`, `agent`, `agentFeeBps` on listings. HTTP API also returns legacy `fiatCurrency: 0|1` (USD/EUR) for existing frontend — see `lib/marketplace/currency-code.ts`.
