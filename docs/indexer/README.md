# Ponder indexer documentation

Three documents, three lifecycles — read in this order during a v2 cutover:

| Step | Document | Lifecycle | You need it when… |
|------|----------|-----------|-------------------|
| 1 | [MIGRATION-V2.md](./MIGRATION-V2.md) | **Temporary** (archive after cutover) | Changing event handlers or `ponder.schema.ts` for generation v2 |
| 2 | [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| 3 | [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | **Per deploy** | Reviewing that deploy’s smoke/verify results and VPS cutover |

## Contract addresses for indexer env

Do **not** copy address tables here. Set `PONDER_*_ADDRESS` from:

- Manifest: `deployments/84532.json` (not in git — run deploy or copy from ops)
- Export: `node --import tsx scripts/lib/print-ponder-env.ts`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532)

**Start block:** `PONDER_START_BLOCK_84532=43399242` (from manifest `indexFromBlock`).

## After cutover

When production indexes generation v2 only, **MIGRATION-V2.md** can move to an archive folder or be deleted. **OPERATIONS.md** stays the runbook for all future reindexes.
