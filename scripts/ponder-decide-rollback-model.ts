/**
 * Compute ADR 0014 §e rollback model from baseline + dual-serve sample files.
 * Writes lag + rollback_model into the state file via the state owner.
 *
 * Refuses unless both files hold ≥3 samples spanning ≥30 minutes for exactly the
 * chains this environment indexes (ponderStatusChainNameById; missing/extra refuse).
 */
import { readFileSync } from "node:fs";
import { ponderStatusChainNameById } from "./lib/ponder-env.js";
import {
  decideRollbackModel,
  type LagSample,
} from "./lib/ponder-rollback-decision.js";
import {
  DeployStateInvalidError,
  readPonderDeployStateFile,
  writePonderDeployStateFile,
} from "./lib/ponder-deploy-state.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function readSamples(path: string): LagSample[] {
  const text = readFileSync(path, "utf8");
  const rows: LagSample[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as LagSample);
  }
  return rows;
}

function main(): void {
  const argv = process.argv.slice(2);
  const baselinePath = argValue(argv, "--baseline");
  const dualPath = argValue(argv, "--dual");
  const statePath = argValue(argv, "--state");
  if (!baselinePath || !dualPath || !statePath) {
    process.stderr.write(
      "usage: ponder-decide-rollback-model --baseline --dual --state\n",
    );
    process.exit(2);
  }

  // R10: the chain set ADR §e requires is the one this environment indexes.
  const expectedChainIds = Object.keys(ponderStatusChainNameById()).map(Number);
  let decision;
  try {
    decision = decideRollbackModel(
      readSamples(baselinePath),
      readSamples(dualPath),
      expectedChainIds,
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("decide_rollback_model_refused")
    ) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  let state;
  try {
    state = readPonderDeployStateFile(statePath);
  } catch (err) {
    if (err instanceof DeployStateInvalidError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  writePonderDeployStateFile(statePath, {
    ...state,
    rollback_model: decision.rollback_model,
    lag: {
      l_single_max: decision.l_single_max,
      m: decision.m,
      b: decision.b,
    },
  });
  process.stdout.write(
    `deploy_evidence rollback_model=${decision.rollback_model}\n`,
  );
  process.stdout.write(
    `deploy_evidence lag l_single_max=${decision.l_single_max} m=${decision.m} b=${decision.b}\n`,
  );
}

main();
