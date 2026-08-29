# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: X2 COMPLETE — mock stand green; awaiting X3 Devnet deploy** (August 29, 2026). Hot `SOLANA_*` roles in `.env.local` (gitignored). No Squads on testnet.

**Hub peer (wiring target):** Nuclear #7 Base Sepolia gateway from manifest only — `0x7324046854342587999984683c4833852FA81827` (EID 40245). Never literal in product code.

**Pinned DVN pair:** `layerzero-labs` + `p2p` (snapshot pathway `40168-40245`).

**Authority split (testnet hot):**
- Upgrade authority of `kar-passport` + `kar-gateway` → `SOLANA_UPGRADE_AUTHORITY`
- Gateway config authority → `SOLANA_GATEWAY_AUTHORITY` or deployer pubkey
- Passport `forfeit_recipient` → `SOLANA_FORFEIT_RECIPIENT`

**Env (`.env.local`):** `SOLANA_DEPLOYER_PRIVATE_KEY` (like EVM deployer key) + public role pubkeys; see `.env.example`. Never commit secrets.

**Tooling:** `svm-deploy` · `bridge:wire` hub↔40168 · stand `--live-both`

---

## X1 — Squads verify (superseded)

| Check | Result |
|-------|--------|
| Candidate Squads as Multisig | **AccountNotFound** |
| Founder decision | **No Squads on testnet** — hot `SOLANA_*` roles |

---

## X2 — EndpointV2 receive types (2026-08-29)

| Item | Result |
|------|--------|
| Mock layout | **13** metas — unchanged; stand path |
| Production layout | **18** metas — M2 indices pinned |
| Clear CPI | mock → `cpi_clear_mock`; production → `endpoint_v2::cpi_clear_production` |
| Selector | `GatewayConfig.endpoint_program` == `76y77…En6` → production |
| Gate | `./svm/stand/run-stand.sh --live-both` **PASS** |

---

## Remaining

| Step | Work |
|------|------|
| X3 | Upgradeable Devnet deploy → hot upgrade authority → init + evidence |
| X4 | Wire 40245↔40168 only; read-only all `[skip]` |
| X5 | Live RT + pin non-EVM budget |
| X6 | SPEC §13.8 (testnet hot allowed) + this record COMPLETE + HANDOFF Next=S5 |
