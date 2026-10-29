/**
 * CLI: retention drop set / SQL from state + schema list.
 *
 *   --drop-list --state <path> --schemas <file> --pre-cutover <0|1>
 *   --drop-sql  --state <path> --schemas <file> --pre-cutover <0|1>
 */
import { readFileSync } from "node:fs";
import {
  dropDeploymentSchemaSql,
  keepSetFromState,
  retentionSchemasToDrop,
} from "./lib/ponder-deploy-retention.js";
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
  const mode = argv[0];
  const statePath = argValue(argv, "--state");
  const schemasPath = argValue(argv, "--schemas");
  const pre = argValue(argv, "--pre-cutover");
  if (
    (mode !== "--drop-list" && mode !== "--drop-sql") ||
    !statePath ||
    !schemasPath ||
    pre === undefined
  ) {
    process.stderr.write(
      "usage: ponder-deploy-retention-cli --drop-list|--drop-sql --state --schemas --pre-cutover\n",
    );
    process.exit(2);
  }

  let loaded;
  try {
    loaded = loadDeployState(statePath, pre === "1" || pre === "true");
  } catch (err) {
    if (err instanceof DeployStateInvalidError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  if (loaded.kind !== "post_cutover") {
    process.stderr.write("deploy_state_invalid: retention requires post_cutover\n");
    process.exit(1);
  }

  const schemas = readFileSync(schemasPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const keep = keepSetFromState(loaded.state);
  const drop = retentionSchemasToDrop(schemas, keep);

  if (mode === "--drop-list") {
    process.stdout.write(`${JSON.stringify(drop)}\n`);
    process.exit(0);
  }

  const lines = drop.map((s) => dropDeploymentSchemaSql(s, keep));
  process.stdout.write(lines.length ? `${lines.join("\n")}\n` : "");
  process.exit(0);
}

main();
