# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: Y1 HAZARD CLOSED — hub peer 40168 unset; destination not proven** (August 29, 2026). Hot `SOLANA_*` roles. No Squads. No `COMMERCIAL_ACTIVE` Solana row.

**Hub gateway (N7, not commercial):** `0x7324046854342587999984683c4833852FA81827` (EID 40245). App still serves Nuclear #4.

**Pinned DVN pair (when wired):** `layerzero-labs` + `p2p`.

**40168 pathway:** deliberately **unwired** (Y1). X4 config retained in evidence `x4Recorded` for Y5 re-apply. Recorded hash was `0x8b8ba527…4231`. Live **40161↔40245** hash H2 unchanged: `0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8`.

## Devnet programs (EID 40168 / namespace `2000040168`)

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf` | hot `SOLANA_UPGRADE_AUTHORITY` (`BSuJ…`) |
| kar_gateway | `ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre` | same |
| mock_staking (aux) | `H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89` | same |

Evidence (gitignored): `deployments/svm-40168.json`. Gateway config authority = deployer. Endpoint = `76y77…En6`.

---

## Authority timeline

| When | Event | Why |
|------|--------|-----|
| 2026-08-29 (X3) | Deploy under deployer → handoff upgrade authority to hot `BSuJ…` | S4b X3 handoff (too early — program incomplete) |
| 2026-08-29 (Y1) | Hub `setPeer(40168, 0)` | Close strand trap until destination proven |
| pending Y2 | Return upgrade authority to deployer | Hot `set-upgrade-authority` signed by `BSuJ…` — finish PeerConfig / register_oapp / send |
| pending Y5 | Re-wire → live RT → hand upgrade authority back to `BSuJ…` | Authority on proven artifact only |

---

## X2 — EndpointV2 receive types

Mock 13 / production 18 (M2); `--live-both` PASS.

## X3 — Devnet deploy

Upgradeable deploy → handoff to hot upgrade authority → init. PASS. (Authority moved before program complete — corrected by S4b-fix.)

## X4 — Hub wire 40245→40168 (superseded by Y1)

Had set peer + ULN labs+p2p + options. **Y1 unset the peer.** Config kept in evidence `x4Recorded` for Y5.

## Y1 — Hazard closed

Tx `0x5925a2bc0676bcacac3fd45dc53ac3af57b623926812db4c69525eae8eace578`: `setPeer(40168, bytes32(0))`. Read-back zero. H2 unchanged. Reason: destination cannot execute (no PeerConfig / register_oapp / production send CPI).

## Remaining (S4b-fix)

| Step | Work |
|------|------|
| Y2 | Return upgrade authority to deployer (hot sign by `BSuJ…`) |
| Y3 | PeerConfig + register_oapp + production send CPI; stand `--live-both` green |
| Y4 | Prove Solana-side with hub still unwired |
| Y5 | Re-wire → live RT both ways → pin budget → hand authority to `BSuJ…` |
