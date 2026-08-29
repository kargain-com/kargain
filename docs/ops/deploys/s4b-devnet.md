# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: REBUILD IN PROGRESS** (August 29, 2026). Hot `SOLANA_*` roles. No Squads. No `COMMERCIAL_ACTIVE` Solana row. Hub peer 40168 remains **unset** until destination proven.

**Hub gateway (N7, not commercial):** `0x7324046854342587999984683c4833852FA81827` (EID 40245). App still serves Nuclear #4.

**Pinned DVN pair (when wired):** `layerzero-labs` + `p2p`.

**Live 40161↔40245 hash H2 unchanged:** `0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8`.

---

## Authority timeline

| When | Event | Why |
|------|--------|-----|
| 2026-08-29 (X3) | Deploy → handoff UA to hot `BSuJ…` via `--skip-new-upgrade-authority-signer-check` | Too early; founder does not hold that secret → programs **locked** |
| 2026-08-29 (Y1) | Hub `setPeer(40168, 0)` | Close strand trap |
| 2026-08-29 (rebuild) | **New program ids**; **deployer retains** upgrade authority | Controllable iteration; abandon X3 ids |
| pending | Wire + live RT + optional handoff to a hot UA the founder controls | Authority on proven artifact only |

### Abandoned X3 programs (unreachable UA `BSuJ…`)

| Program | Program id |
|---------|------------|
| kar_passport | `x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf` |
| kar_gateway | `ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre` |
| mock_staking | `H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89` |

---

## Rebuild programs

Filled after `pnpm deploy:svm` (evidence `deployments/svm-40168.json`).

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | *(pending deploy)* | deployer (retained) |
| kar_gateway | *(pending deploy)* | deployer (retained) |
| mock_staking (aux) | *(pending deploy)* | deployer (retained) |

Gateway adds: `PeerConfig` / `SetPeer` (hub 40245 only), `RegisterOApp` CPI, production receive peer check (`Origin.sender`). Production send CPI still outstanding for Solana→hub.

**Tooling:** `pnpm deploy:svm` · `bridge:wire:solana*` · stand `--live-both`

---

## Prior steps (historical)

- X2 EndpointV2 receive types — mock 13 / production clear path — PASS
- X3 first deploy — abandoned (UA trap)
- X4 hub wire — superseded by Y1 unset
- Y1 hazard closed — peer zero
