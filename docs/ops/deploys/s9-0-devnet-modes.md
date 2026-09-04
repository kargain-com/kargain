# S9-0 — Devnet FixedPrice + Ascending (commerce programs)

**Status: READY (code)** — founder runs live deploy before S9-A / S9-B.

Standing UA: [svm-devnet.md](./svm-devnet.md) — S4–S9 deployer retains upgrade authority.

**This unit does not enable ingest, does not touch VPS, and does not add a Solana `COMMERCIAL_ACTIVE` row.** Enabling svm-ingest is **S9-B** after the registry row (S9-A).

## Why

S9 readiness requires lots, portfolios, and claims on three networks. Passport+gateway+staking alone cannot satisfy that criterion. Ingest follows **six** commercial programs and refuses when any `programId` or `deploySlot` is missing (`lib/svm/ingest-config.ts` → `assertSvmCommercialEvidence`).

## Founder order

### 1. Preconditions

- `.env.local`: `SOLANA_RPC_URL`, `SOLANA_DEPLOYER_PRIVATE_KEY`, `SOLANA_UPGRADE_AUTHORITY` (= deployer pubkey)
- Four live programs untouched: `kar_passport`, `kar_gateway`, `kar_pro_staking`, `kar_pro_pass`
- UA ≡ deployer for those four (`pnpm verify:svm-authority` should already pass for them)

### 2. Dry-run / build modes

```bash
pnpm deploy:svm:dry-run   # lists all six commercial programs
# or build only:
(cd svm/programs/kar-fixed-price && cargo-build-sbf --arch v3)
(cd svm/programs/kar-ascending && cargo-build-sbf --arch v3)
```

### 3. Deploy FixedPrice then Ascending

```bash
./svm/scripts/deploy-s9-0-modes.sh
```

Builds and deploys **only** `kar_fixed_price` + `kar_ascending` under retained deployer UA.

**Reversibility:** BPF upgrade / redeploy of **modes only** is reversible under deployer UA. Passport / gateway / staking / pass are **not** touched by this script.

### 4. Update gitignored evidence

Edit `deployments/svm-40168.json`:

| Key | Required |
|-----|----------|
| `programs.kar_fixed_price.programId` | yes (new) |
| `programs.kar_fixed_price.deploySlot` | yes (slot at deploy) |
| `programs.kar_ascending.programId` | yes (new) |
| `programs.kar_ascending.deploySlot` | yes (slot at deploy) |
| `programs.{passport,gateway,staking,pass}.programId` | leave existing |
| `programs.{passport,gateway,staking,pass}.deploySlot` | true historical deploy slots (fill if missing) |
| `programs.*.upgradeAuthority` | deployer pubkey |

Optional root fields `indexFromSlot` / `slotAtEvidence` are **annotations / snapshots only** — ingest **ignores** them.

### 5. Verify UA

```bash
pnpm verify:svm-authority
pnpm deploy:svm:dry-run
```

### 6. Explicit non-goals

- **No VPS** work in S9-0
- **Do not enable** the `svm-ingest` compose service
- Do **not** cut over `COMMERCIAL_ACTIVE` (that is S9-A)

### 7. Follow cursor (irreversibility)

Ingest start slot = **`min(deploySlot)`** over the six commercial keys.

- Redeploying **one** program with a **higher** `deploySlot` does **not** move the cursor (min stays with the earliest).
- Raising the minimum (all six, or rewriting the earliest program’s slot) **permanently skips** earlier slots for raw ingest without a raw rebuild.

## Init / admit (founder)

Mode config init (USDC mint Circle Devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, platform/forfeit sinks, Pyth pins for fiat) follows the same ownership as S6 LIVE stand — use stand scripts adapted for Devnet program ids. Record evidence before S9-A registry row.

## Gates

- `test:verify` includes `svm-deploy-plan` (six names) + `svm-commercial-program-census-policy`
- Load / ingest startup throws `MissingCommercialProgramError` if evidence lacks a commercial `programId` or `deploySlot`
