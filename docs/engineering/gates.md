# Gates

Map the **kind of change** to a targeted `pnpm test:*` group, then run that group. *Where* each gate runs and *when* it is mandatory live only in [`AGENTS.md` § Gates](../../AGENTS.md#gates) — this page does not restate them.

Always run `pnpm build`, `pnpm typecheck`, and `pnpm lint` on every PR (see AGENTS). `pnpm typecheck` is the union of every typecheck project. Bare `pnpm test` runs exactly the Hardhat-native suites in [`lib/architecture/hardhat-test-suites.ts`](../../lib/architecture/hardhat-test-suites.ts) — it is not a substitute for the targeted group that owns the layer you changed.

## Change type → targeted group

| Change type | Targeted group(s) |
|-------------|-------------------|
| Deploy plan, addresses, Nuclear ordering, error/ABI policy, module choke-point / import-ban policy, commerce Hardhat suites folded into verify, typecheck project membership | `pnpm test:verify` |
| Scripts / Hardhat / Node tooling under `scripts/` (beyond policy) | `pnpm typecheck` · relevant `test:*` |
| Test-suite TypeScript under `test/` (beyond the owning group) | `pnpm typecheck` · owning `test:*` |
| Commerce / settlement / challenge / consignment / claims presentation and policy | `pnpm test:commerce-ui` |
| Passport bridge | `pnpm test:bridge` |
| SVM programs / crates | `pnpm test:svm` |
| Local cross-VM stand · `svm/stand` / `svm/lab/scripts` TypeScript | `pnpm test:svm-stand` · `pnpm typecheck` |
| Passport presentation and upload | `pnpm test:passport-ui` |
| Verifier admission, status, directory, KarPro slug | `pnpm test:verifier` |
| Ponder schema, handlers, commerce HTTP readers, `src/` / ponder.config | `pnpm test:ponder` · `pnpm typecheck` |
| SVM raw ingest | `pnpm test:svm-ingest` |
| Marketplace browse filter / FX query params | `pnpm test:listing` |
| Passport metadata wire / parse | `pnpm test:metadata` |
| Trust signal helpers | `pnpm test:trust` |
| Typed passport records | `pnpm test:records` |
| Listing chain-status confirm | `pnpm test:confirm-status` |
| Place / Photon geo | `pnpm test:geo` |
| Nostr key manager | `pnpm test:nostr` |
| Messaging session, consent, devices, compose-draft, I1–I20 | `pnpm test:messaging` |
| Notification state / feed mappers | `pnpm test:notifications` |
| Vincent Commons | `pnpm test:vincent-commons` |
| VIN insight / assist / Vincent offline | `pnpm test:vin-insight` · `test:vin-assist` · `test:vincent` |
| Hardhat-native contract / edr suites (declared list only) | `pnpm test` |
| Helper / non-layer Node unit suites | `pnpm test:unit` |
| Local E2E against a running Hardhat node | `pnpm test:e2e` |
| Live Vincent network | `pnpm test:vincent:live` (opt-in; not a default ship gate) |

Deploy-path changes also prove deploy policy suites (`test:verify`, including suites that CI omits as deploy-machine-only).

## Membership and reachability

**One owner per test file.** A suite is listed in exactly one targeted `test:*` group (or in the Hardhat declared list). Commerce Hardhat suites folded into verify are the stated dual-home exception. Opt-in gates such as `test:vincent:live` sit outside the one-owner invariant.

**Every suite is reachable from a gate.** Helper units that are not a layer live in `test:unit`. If you cannot name the group for something you are about to modify, the map is missing a row — add it. Do not park the file in the architectural-policy group for lack of a home.

**`pnpm test:ci`** is derived: `test:verify` minus the deploy-machine enumerator in [`lib/architecture/ci-verify-partition.ts`](../../lib/architecture/ci-verify-partition.ts) — not a second file list. Membership is enforced by [`test/gate-membership-policy.test.ts`](../../test/gate-membership-policy.test.ts) (with Hardhat partition policy). Do not hand-copy suite membership from `package.json` or [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml); the scripts and the partition module are the owners.

## Reading gate results

9. A gate is worth more than the review that produced it; keep and name the gate.

Say what a test-count delta **is** (added / relocated / double-counted). A falling test count is not automatically a regression — state the arithmetic. Never quote a fixed test count; say "all passing" ([`AGENTS.md`](../../AGENTS.md#gates)).

Gates are only evidence if they ran. Do not treat "ran `pnpm test`" as evidence that a brief which named `test:commerce-ui` hit that group.
