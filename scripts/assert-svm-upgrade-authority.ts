/**
 * Read-only: every live program in svm-{eid} evidence must match on-chain
 * ProgramData Authority. Commercial six-program census required (verify path).
 *
 *   pnpm verify:svm-authority
 *   pnpm verify:svm-authority -- --eid=40168
 */
import { spawnSync } from "node:child_process";

import { config as loadEnv } from "dotenv";

import {
  assertSvmCommercialEvidence,
  MissingCommercialProgramError,
} from "../lib/svm/ingest-config.js";
import {
  assertSvmUpgradeAuthority,
  formatSvmAuthorityFailure,
  parseProgramShowAuthority,
} from "./lib/assert-svm-upgrade-authority.js";
import {
  requireSvmDevnetEvidence,
  svmDevnetEvidencePath,
} from "./lib/load-deployment.js";

loadEnv({ path: ".env.local" });
loadEnv();

function parseEid(argv: string[]): number {
  for (const a of argv) {
    const m = /^--eid=(\d+)$/.exec(a);
    if (m) return Number(m[1]);
  }
  return 40168;
}

function fetchViaSolanaCli(programId: string, rpc: string): string | null {
  const r = spawnSync(
    "solana",
    ["program", "show", programId, "-u", rpc],
    { encoding: "utf8" },
  );
  if (r.error) {
    throw new Error(
      `solana CLI unavailable (${r.error.message}) — add to PATH`,
    );
  }
  if (r.status !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `solana program show exit ${r.status}`).trim(),
    );
  }
  return parseProgramShowAuthority(r.stdout || "");
}

async function main() {
  const eid = parseEid(process.argv.slice(2));
  const rpc =
    process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";

  let evidence;
  try {
    evidence = requireSvmDevnetEvidence(eid);
  } catch {
    console.error(`Missing ${svmDevnetEvidencePath(eid)} — run deploy:svm first`);
    process.exit(1);
  }

  try {
    assertSvmCommercialEvidence(evidence);
  } catch (err) {
    if (err instanceof MissingCommercialProgramError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  console.log(
    `SVM upgrade authority — eid ${eid} rpc=${rpc} evidence=${svmDevnetEvidencePath(eid)}`,
  );

  const result = await assertSvmUpgradeAuthority(evidence, (programId) =>
    Promise.resolve(fetchViaSolanaCli(programId, rpc)),
  );

  if (!result.ok) {
    console.error(formatSvmAuthorityFailure(result));
    process.exit(1);
  }

  console.log(`  OK ${result.checked} live program(s) evidence ≡ on-chain Authority`);
  console.log("\nAuthority evidence intact.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
