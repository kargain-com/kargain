/**
 * CLI: validate one probe-observation JSON blob (stdin or --json).
 * Success: prints canonical JSON on stdout, exit 0.
 * Failure: prints deploy_observation_failed: <target> on stderr, exit 1.
 */
import { readFileSync } from "node:fs";
import { parseProbeObservationJson } from "./lib/ponder-probe-observation.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const target = argValue(argv, "--target");
  if (!target) {
    process.stderr.write(
      "usage: ponder-probe-observation-cli --target <name> [--json <blob>]\n",
    );
    process.exit(2);
  }
  const fromFlag = argValue(argv, "--json");
  const raw = (fromFlag ?? readFileSync(0, "utf8")).trim();
  const parsed = parseProbeObservationJson(raw);
  if (!parsed.ok) {
    process.stderr.write(`deploy_observation_failed: ${target}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(parsed.value)}\n`);
}

main();
