# Smart contracts documentation

## One specification

All contract behavior, semver, deployments, and passport metadata live in **[SPEC.md](./SPEC.md)**.

Do not maintain parallel contract docs. If you need to document a contract change, edit **SPEC.md** in the matching part:

| Part | Contents |
|------|----------|
| **I** | Generation v2 (current) — all seven contracts, security, deploy sequence |
| **I.9.1** | **Active Base Sepolia addresses** (only copy in the repo) |
| **II** | Generation v1.x (historical behavior) |
| **II.4** | **Historical Base Sepolia addresses** (only copy for v1.x) |
| **III** | Metadata JSON wire format (`tokenURI`) |
| **IV** | v1 → v2 migration reference table |
| **V** | Version policy (`-rc.N`, semver rules) |
| **Appendix** | Local E2E, test commands |

## Related

| Topic | Document |
|-------|----------|
| Indexer cutover | [../indexer/MIGRATION-V2.md](../indexer/MIGRATION-V2.md) |
| Indexer reindex | [../indexer/OPERATIONS.md](../indexer/OPERATIONS.md) |
| Deploy record (84532) | [../ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) |
| UI | [../design-spec.md](../design-spec.md) |
