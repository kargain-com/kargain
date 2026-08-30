# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: COMPLETE** (August 30, 2026 — delivered when commits + full gate pass land). Live bidirectional RT proven; receive CU/rent pinned with provenance; upgrade authority handed to `SOLANA_UPGRADE_AUTHORITY` (`BSuJ…`). No Solana `COMMERCIAL_ACTIVE` row. App still serves Nuclear #4.

**Hub gateway (N7, not commercial):** `0x7324046854342587999984683c4833852FA81827` (EID 40245).

**Pinned DVN pair:** `layerzero-labs` + `p2p`.

**Live 40161↔40245 hash H2 unchanged:** `0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8`.

**Spoke OApp peer (hub setPeer):** gateway_config PDA `J8h6ErcR6b2xqTNQ8GLJwEKfy9aodys8SC11EuBPkC1b` (not program id).

---

## Abandoned X3 generation (do not use)

**Date abandoned:** 2026-08-29.  
**Reason:** upgrade authority was handed to hot pubkey `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` **before** destination proof, via `--skip-new-upgrade-authority-signer-check`. Founder does not hold that secret → programs **locked**; rebuild with new program ids was required. These ids are **not** a second live stack.

| Program | Program id (abandoned) |
|---------|------------------------|
| kar_passport | `x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf` |
| kar_gateway | `ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre` |
| mock_staking | `H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89` |

---

## Authority timeline

| When | Event | Why |
|------|--------|-----|
| 2026-08-29 (X3) | Deploy → handoff UA to hot `BSuJ…` via `--skip-new-upgrade-authority-signer-check` | Too early; founder does not hold that secret → programs **locked** |
| 2026-08-29 (Y1) | Hub `setPeer(40168, 0)` | Close strand trap |
| 2026-08-29 (rebuild) | **New program ids**; **deployer retains** upgrade authority | Controllable iteration; abandon X3 ids |
| 2026-08-30 (Y4) | RegisterOApp + SetPeer(40245) + production `lz_receive_types`; gateway upgrade (CPI layout) | Destination ready; hub still peer-zero |
| 2026-08-30 (Y5) | Production send CPI; hub wire; live RT both ways; pin `lz-receive-gas`; UA → `BSuJ…` (after RT) | S4b COMPLETE |

---

## Rebuild programs (live)

Evidence: `deployments/svm-40168.json` (gitignored).

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |
| kar_gateway | `EZNVaX7Xn4TER4uVxZpx8Xj87pdfTsXucMHtPJPEGbgr` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |
| mock_staking (aux) | `9YCgDdCkasCzziNonKJMimKJxL3fdc8s4w8HZSpLAm2s` | deployer (aux) |

**Config PDAs:** passport `EVsAdRnPHvRr4Bic6VcwYc8XgbsjX15WushzGWnQhNRi` · gateway `J8h6ErcR6b2xqTNQ8GLJwEKfy9aodys8SC11EuBPkC1b` · LzReceiveTypes `AGYytm4vUgD7xwFZ9tZfhSwSVhukcL8XsihsoRrxKTWh`

### Y5 proven

- Production EndpointV2 **send CPI** (mock path keeps `set_return_data`; stand `--live-both` green)
- Pathway init: send/receive library + nonce + ULN OApp config (labs+p2p); EXECUTOR = **ExecutorConfig PDA**
- Hub wire 40245→40168 (all `[skip]` on read-only); H2 for 40161 unchanged
- Live RT: mint N7 with `ar://s4b-y5-rt-2026-08-30-n7-devnet` → Solana foreign mint → Solana→hub unlock to deployer; URI carried; status UNVERIFIED
- Receive budget pin (provenance): compute **69_819 → ×2.0 → 139_638** CU; rent-exempt **7_189_680 → ×1.5 → 10_784_520** lamports — [`lz-receive-gas.ts`](../../../lib/web3/bridge/lz-receive-gas.ts); row in [`svm/lab/RESULTS.md`](../../../svm/lab/RESULTS.md). Send ≈280_078 CU is **not** the receive pin.
- ALT: Y5 tooling uses ephemeral per-send tables (authority = deployer). Product must not depend on a durable hot-key ALT (SPEC §13.4).

**Tooling:** `pnpm deploy:svm` · `pnpm svm:pathway-init` · `pnpm svm:y5-rt` · `bridge:wire:solana*` · stand `--live-both`

---

## Prior steps (historical)

- X2 EndpointV2 receive types — mock 13 / production clear path — PASS
- X3 first deploy — abandoned (UA trap) — see **Abandoned X3 generation**
- X4 hub wire — superseded by Y1 unset
- Y1 hazard closed — peer zero
- Rebuild deploy — PASS (retain deployer UA until Y5)
- Y4 destination prove — PASS
