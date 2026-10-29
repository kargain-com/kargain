/**
 * CLI: run the pure deploy plan; print actions JSON on stdout.
 * Usage: node --import tsx scripts/ponder-deploy-plan-cli.ts \
 *   --state <path> --observations <path> --operation <deploy|hold|rollback> \
 *   --deploy-sha <sha>
 */
import { readFileSync } from "node:fs";
import {
  planPonderDeploy,
  type PonderDeployObservations,
  type PonderDeployOperation,
} from "./lib/ponder-deploy-plan.js";
import {
  DeployStateInvalidError,
  parsePonderDeployState,
} from "./lib/ponder-deploy-state.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const statePath = argValue(argv, "--state");
  const obsPath = argValue(argv, "--observations");
  const operation = argValue(argv, "--operation") as
    | PonderDeployOperation
    | undefined;
  const deploySha = argValue(argv, "--deploy-sha");
  if (!statePath || !obsPath || !operation || !deploySha) {
    process.stderr.write(
      "usage: ponder-deploy-plan-cli --state --observations --operation --deploy-sha\n",
    );
    process.exit(2);
  }
  if (
    operation !== "deploy" &&
    operation !== "hold" &&
    operation !== "rollback"
  ) {
    process.stderr.write(`invalid operation ${operation}\n`);
    process.exit(2);
  }

  let stateRaw: unknown;
  try {
    stateRaw = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    process.stderr.write("deploy_state_invalid: JSON parse failed\n");
    process.exit(1);
  }

  let state;
  try {
    state = parsePonderDeployState(stateRaw);
  } catch (err) {
    if (err instanceof DeployStateInvalidError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const observations = JSON.parse(
    readFileSync(obsPath, "utf8"),
  ) as PonderDeployObservations;

  const result = planPonderDeploy({
    state,
    operation,
    deploySha,
    observations,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
