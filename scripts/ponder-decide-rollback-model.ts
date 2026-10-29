/**
 * Compute ADR 0014 §e rollback model from baseline + dual-serve sample files.
 * Writes lag + rollback_model into the state file via the state owner.
 *
 * Refuses unless both files hold ≥3 samples per chain spanning ≥30 minutes.
 */
import { readFileSync } from "node:fs";
import {
  DeployStateInvalidError,
  readPonderDeployStateFile,
  writePonderDeployStateFile,
  type PonderDeployState,
  type PonderRollbackModel,
} from "./lib/ponder-deploy-state.js";
import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "./lib/load-deployment.js";

type Sample = {
  chainId: number;
  lag_seconds: number;
  at: string;
  sampleAt?: string;
};

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function readSamples(path: string): Sample[] {
  const text = readFileSync(path, "utf8");
  const rows: Sample[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as Sample);
  }
  return rows;
}

function validateSamples(label: string, rows: Sample[]): void {
  const chains = [SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID];
  for (const chainId of chains) {
    const forChain = rows.filter((r) => r.chainId === chainId);
    if (forChain.length < 3) {
      throw new Error(
        `decide_rollback_model_refused: ${label} needs ≥3 samples for chain ${chainId}, got ${forChain.length}`,
      );
    }
    const times = forChain.map((r) => Date.parse(r.at || r.sampleAt || ""));
    if (times.some((t) => Number.isNaN(t))) {
      throw new Error(
        `decide_rollback_model_refused: ${label} sample missing valid at timestamp`,
      );
    }
    const spanMs = Math.max(...times) - Math.min(...times);
    if (spanMs < 30 * 60 * 1000) {
      throw new Error(
        `decide_rollback_model_refused: ${label} chain ${chainId} span ${spanMs}ms < 30m`,
      );
    }
  }
}

export function decideRollbackModel(
  baseline: Sample[],
  dual: Sample[],
): {
  l_single_max: number;
  m: number;
  b: number;
  rollback_model: PonderRollbackModel;
} {
  validateSamples("baseline", baseline);
  validateSamples("dual", dual);

  const l_single_max = Math.max(...baseline.map((r) => r.lag_seconds));
  const m = Math.max(l_single_max, 30);
  const b = l_single_max + m;

  const pass = dual.every((r) => r.lag_seconds <= b);
  return {
    l_single_max,
    m,
    b,
    rollback_model: pass ? "keep_previous" : "restart_previous",
  };
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

  const decision = decideRollbackModel(
    readSamples(baselinePath),
    readSamples(dualPath),
  );

  let state: PonderDeployState;
  try {
    state = readPonderDeployStateFile(statePath);
  } catch (err) {
    if (err instanceof DeployStateInvalidError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const next: PonderDeployState = {
    ...state,
    rollback_model: decision.rollback_model,
    lag: {
      l_single_max: decision.l_single_max,
      m: decision.m,
      b: decision.b,
    },
  };
  writePonderDeployStateFile(statePath, next);
  process.stdout.write(
    `deploy_evidence rollback_model=${decision.rollback_model}\n`,
  );
  process.stdout.write(
    `deploy_evidence lag l_single_max=${decision.l_single_max} m=${decision.m} b=${decision.b}\n`,
  );
}

main();
