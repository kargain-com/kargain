/**
 * CLI: run the pure deploy plan; print actions JSON on stdout.
 * Usage: node --import tsx scripts/ponder-deploy-plan-cli.ts \
 *   --state <path> --observations <path> --operation <deploy|hold|rollback> \
 *   --pre-cutover <0|1>
 */
import { existsSync, readFileSync } from "node:fs";
import {
  planPonderDeploy,
  type PonderDeployObservations,
  type PonderDeployOperation,
} from "./lib/ponder-deploy-plan.js";
import {
  DeployStateInvalidError,
  loadDeployState,
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
  const preFlag = argValue(argv, "--pre-cutover");
  if (!statePath || !obsPath || !operation || preFlag === undefined) {
    process.stderr.write(
      "usage: ponder-deploy-plan-cli --state --observations --operation --pre-cutover\n",
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

  let observations: PonderDeployObservations;
  try {
    observations = JSON.parse(
      readFileSync(obsPath, "utf8"),
    ) as PonderDeployObservations;
  } catch {
    process.stderr.write("deploy_observation_failed: observations JSON\n");
    process.exit(1);
  }

  if (
    observations.eventName !== "push" &&
    observations.eventName !== "workflow_dispatch"
  ) {
    process.stderr.write("deploy_observation_failed: event_name\n");
    process.exit(1);
  }

  const preCutoverObserved = preFlag === "1" || preFlag === "true";
  let loaded: Parameters<typeof planPonderDeploy>[0]["loaded"];
  if (!existsSync(statePath)) {
    loaded = { kind: "missing" };
  } else {
    try {
      loaded = loadDeployState(statePath, preCutoverObserved);
    } catch (err) {
      if (err instanceof DeployStateInvalidError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  }

  const result = planPonderDeploy({
    loaded,
    operation,
    observations,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
