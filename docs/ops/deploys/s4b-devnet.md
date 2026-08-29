# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: X4 HUB WIRED — not cut over** (August 29, 2026). Hot `SOLANA_*` roles. No Squads. No `COMMERCIAL_ACTIVE` Solana row.

**Hub peer (wired):** Nuclear #7 Base Sepolia gateway from manifest only — `0x7324046854342587999984683c4833852FA81827` (EID 40245).

**Pinned DVN pair:** `layerzero-labs` + `p2p`.

**Hub pathwayConfigHash (40168↔40245):** `0x8b8ba5273130c6625dee0b4bdfc321a00e5b0272807dc9f4c89ffce1b88b4231` (evidence `deployments/svm-40168.json`; live `40161↔40245` hash H2 unchanged).

## Devnet programs (EID 40168 / namespace `2000040168`)

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf` | hot `SOLANA_UPGRADE_AUTHORITY` |
| kar_gateway | `ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre` | same |
| mock_staking (aux) | `H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89` | same |

Evidence (gitignored): `deployments/svm-40168.json`. Gateway config authority = deployer pubkey. Endpoint = `76y77…En6`. Forfeit = `SOLANA_FORFEIT_RECIPIENT`.

**Tooling:** `pnpm deploy:svm` · `pnpm bridge:wire -- --spoke-eid=40168` · stand `--live-both`

---

## X2 — EndpointV2 receive types

Mock 13 / production 18 (M2); `--live-both` PASS.

## X3 — Devnet deploy

Upgradeable deploy → `--skip-new-upgrade-authority-signer-check` handoff → init passport/gateway + setBridgeGateway. PASS.

## X4 — Hub wire 40245→40168

Hub-only: `setPeer(40168, svmGatewayBytes32)` + send/recv libs + ULN (labs+p2p) + executor + enforcedOptions. `bridge:wire -- --spoke-eid=40168 --read-only` → all `[skip]`.

**Honest gap (X5):** `kar-gateway` has no Solana `PeerConfig` / Endpoint `register_oapp` / production `send` CPI yet. Reciprocal SVM trust and live RT need that program surface (upgrade authority key or redeploy). Star still forbids 40161↔40168.

## Remaining

| Step | Work |
|------|------|
| X5 | Live RT + pin non-EVM budget (needs SVM peer/register/send) |
| X6 | SPEC §13.8 + archive evidence + HANDOFF Next=S5 |
