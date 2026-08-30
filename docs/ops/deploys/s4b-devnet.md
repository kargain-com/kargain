# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: COMPLETE (S5-recover-R5 re-close)** (August 30, 2026). Live bidirectional RT proven on **new** passport/gateway under **deployer** UA. Y5-frozen `FsDmjkr…` / `EZNVaX7X…` abandoned (see below). Receive CU/rent pins unchanged. No Solana `COMMERCIAL_ACTIVE` row. App still serves Nuclear #4.

**Standing UA policy:** [svm-devnet.md](./svm-devnet.md) — S4–S8 deployer retains upgrade authority; no skip-signer; `pnpm verify:svm-authority`.

**Hub gateway (N7, not commercial):** `0x7324046854342587999984683c4833852FA81827` (EID 40245).

**Pinned DVN pair:** `layerzero-labs` + `p2p`.

**Live 40161↔40245 hash H2 unchanged:** `0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8`.

**40168↔40245 `pathwayConfigHash` (live after R5):** `0xc43a641bc5a50afc987fdc278f9bb1df64e5a1dfc5150b5d66233c1a376a7c98` (new gateway_config PDA). Historical Y5-frozen hash: `0x5d4b11319bdf996b2c09b17ada09abfd2c2c2b8c413a133368338b3f5f0c9c82`.

**Spoke OApp peer (hub setPeer):** gateway_config PDA `GmLEN2Tff1DfqW3rHTs97jqj5QNPhamRbsouDArmQ4Uj` (not program id).

---

## Live programs (S5-recover-R5)

Evidence: `deployments/svm-40168.json` (gitignored).

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ` | deployer `65Qmw…` |
| kar_gateway | `9ugwozoJteH4D5XQmwvprevsZ6uWLoHEcWZWeVbDn693` | deployer `65Qmw…` |
| mock_staking (aux) | `6Kr9LbxT8WXsVjapLfzQ7dDGgk57e8aeP8Kp2qBWRoNc` | deployer |

**Config PDAs:** passport `4rsVEChyam3qQV3586sGf2m7A6gm76QA66TGKW82Bz1G` · gateway `GmLEN2Tff1DfqW3rHTs97jqj5QNPhamRbsouDArmQ4Uj`

### R5 proven

- Redeploy passport + gateway; deployer UA retained; `verify:svm-authority` green
- Y1 hub `setPeer(40168, 0)` → Y4 RegisterOApp / SetPeer / LzReceiveTypes → pathway init → hub wire
- Live RT both ways (URI `ar://s4b-y5-rt-2026-08-30-n7-devnet`); receive pin unchanged (139_638 CU / 10_784_520 lamports)
- H2 unchanged

**Tooling:** `pnpm deploy:svm` · `pnpm svm:pathway-init` · `pnpm svm:y5-rt` · `bridge:wire:solana*` · `pnpm verify:svm-authority` · stand `--live-both`

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

## Abandoned Y5-frozen rebuild (do not use)

**Date abandoned:** 2026-08-30 (S5-recover-R3).  
**Reason:** after Y5 RT, upgrade authority for passport + gateway was handed to the same unreachable `BSuJ…` via `--skip-new-upgrade-authority-signer-check`. On-chain Authority = `BSuJ…`; `solana account BSuJ…` → `AccountNotFound`. Same lock class as X3. Superseded by **Live programs (S5-recover-R5)**.

| Program | Program id (frozen / abandoned) | On-chain Authority |
|---------|----------------------------------|--------------------|
| kar_passport | `FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |
| kar_gateway | `EZNVaX7Xn4TER4uVxZpx8Xj87pdfTsXucMHtPJPEGbgr` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |

---

## Authority timeline

| When | Event | Why |
|------|--------|-----|
| 2026-08-29 (X3) | Deploy → handoff UA to hot `BSuJ…` via skip-signer | Locked |
| 2026-08-29 (Y1) | Hub `setPeer(40168, 0)` | Close strand trap |
| 2026-08-29 (rebuild) | New program ids; deployer UA | Controllable iteration |
| 2026-08-30 (Y4/Y5) | Destination prove + live RT; then UA → `BSuJ…` | RT proven; then UA lock |
| 2026-08-30 (S4b-pin) | Hub enforcedOptions → 139_638 / 10_784_520 | Dual floor closed |
| 2026-08-30 (S5-recover-R3) | Abandon `FsDmjkr…` / `EZNVaX7X…` | Skip-signer + unreachable UA |
| 2026-08-30 (S5-recover-R5) | Redeploy `Arvcryx…` / `9ugwozo…`; Y1→Y4→wire→RT; deployer UA | Re-close S4b pathway |

---

## Prior steps (historical)

- X2 EndpointV2 receive types — PASS
- X3 first deploy — abandoned — **Abandoned X3 generation**
- Rebuild + Y4/Y5 on `FsDmjkr…` — RT PASS; UA locked — **Abandoned Y5-frozen rebuild**
- S5-recover-R5 — **Live programs** above
