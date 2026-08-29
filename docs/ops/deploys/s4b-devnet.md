# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: X3 DEPLOYED ON DEVNET — not cut over** (August 29, 2026). Hot `SOLANA_*` roles. No Squads. No `COMMERCIAL_ACTIVE` Solana row.

**Hub peer (wiring target):** Nuclear #7 Base Sepolia gateway from manifest only — `0x7324046854342587999984683c4833852FA81827` (EID 40245).

**Pinned DVN pair:** `layerzero-labs` + `p2p`.

## Devnet programs (EID 40168 / namespace `2000040168`)

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf` | hot `SOLANA_UPGRADE_AUTHORITY` |
| kar_gateway | `ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre` | same |
| mock_staking (aux) | `H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89` | same |

Evidence (gitignored): `deployments/svm-40168.json`. Gateway config authority = deployer pubkey. Endpoint = `76y77…En6`. Forfeit = `SOLANA_FORFEIT_RECIPIENT`.

**Tooling:** `pnpm deploy:svm` · `bridge:wire` · stand `--live-both`

---

## X2 — EndpointV2 receive types

Mock 13 / production 18 (M2); `--live-both` PASS.

## X3 — Devnet deploy

Upgradeable deploy → `--skip-new-upgrade-authority-signer-check` handoff → init passport/gateway + setBridgeGateway. PASS.

## Remaining

| Step | Work |
|------|------|
| X4 | Wire 40245↔40168 only; read-only all `[skip]` |
| X5 | Live RT + pin non-EVM budget |
| X6 | SPEC §13.8 + archive evidence + HANDOFF Next=S5 |
