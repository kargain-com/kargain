/**
 * One step of the Ponder deploy (ADR 0016 §e), run inside `ponder-deploy`
 * by scripts/ponder-deploy.sh:
 *
 *   ponder-deploy-step.ts --begin <deploy|rollback> <commit> <repository>
 *   ponder-deploy-step.ts --resume <host status>
 *
 * Writes the next host action to `.ponder-deploy/run/action` as one line
 * (`exit <code>` when the run is over). On `--resume`, the previous action's
 * output arrives on stdin, so the host never writes into `.ponder-deploy/`.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

import { computePonderIdentities } from "./lib/ponder-executable-fingerprint.js";
import {
  completePendingEntry,
  createJournaledWorld,
  HostActionRequested,
  JournalDivergence,
  type ContainerEffects,
  type DeployJournal,
} from "./lib/ponder-deploy-journal.js";
import { dropSchemaSql } from "./lib/ponder-deploy-retention.js";
import {
  readStateFile,
  serializeDeployState,
  writeFileReplacing,
} from "./lib/ponder-deploy-state.js";
import {
  DEPLOY_OPERATIONS,
  runPonderDeploy,
  type DeployOperation,
} from "./lib/ponder-deploy-switch.js";
import { resolvePonderConnectionString } from "./lib/ponder-env.js";
import { waitForPonderReady } from "./lib/ponder-readiness-probe.js";
import { runPonderDeployPreflight } from "./ponder-deploy-preflight.js";

const DEPLOY_DIR = ".ponder-deploy";
const RUN_DIR = join(DEPLOY_DIR, "run");
const STATE_PATH = join(DEPLOY_DIR, "state.json");
const JOURNAL_PATH = join(RUN_DIR, "journal.json");
const ACTION_PATH = join(RUN_DIR, "action");

const COMMIT_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_RE = /^[a-z0-9][a-z0-9._/-]*$/;

function usage(detail: string): never {
  throw new Error(`ponder-deploy-step: ${detail}`);
}

function parseBegin(args: readonly string[]): DeployJournal {
  const [operation, commit, repository] = args;
  if (!DEPLOY_OPERATIONS.includes(operation as DeployOperation)) {
    usage(`operation must be one of ${DEPLOY_OPERATIONS.join("|")}`);
  }
  if (!commit || !COMMIT_RE.test(commit)) usage("commit must be 40 hex");
  if (!repository || !REPOSITORY_RE.test(repository)) usage("invalid repository");
  return {
    operation: operation as DeployOperation,
    commit,
    repository,
    entries: [],
  };
}

function withPool<T>(fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const connectionString = resolvePonderConnectionString();
  if (!connectionString) usage("no Postgres connection string");
  const pool = new pg.Pool({ connectionString, max: 1 });
  return fn(pool).finally(() => pool.end());
}

const containerEffects: ContainerEffects = {
  write: (text) => {
    process.stdout.write(text);
  },
  readState: async () => readStateFile(STATE_PATH),
  writeState: async (state) => {
    writeFileReplacing(STATE_PATH, serializeDeployState(state));
  },
  identities: async () => {
    const ids = computePonderIdentities(process.cwd());
    return { indexing: ids.indexing.digest, executable: ids.executable.digest };
  },
  preflight: async () => {
    let output = "";
    const code = await runPonderDeployPreflight({
      stdoutWrite: (chunk) => {
        output += chunk;
      },
    });
    return { code, output };
  },
  probe: (mode) => waitForPonderReady({ mode }),
  listSchemas: () =>
    withPool(async (pool) => {
      const r = await pool.query<{ schema_name: string }>(
        "SELECT schema_name FROM information_schema.schemata",
      );
      return r.rows.map((row) => row.schema_name);
    }),
  dropSchema: (schema) =>
    withPool(async (pool) => {
      await pool.query(dropSchemaSql(schema));
    }),
  readBuildId: (schema) =>
    withPool(async (pool) => {
      const exists = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = '_ponder_meta'",
        [schema],
      );
      if (exists.rowCount === 0) return null;
      const r = await pool.query<{ build_id: string | null }>(
        `SELECT value->>'build_id' AS build_id FROM "${schema.replace(/"/g, '""')}"."_ponder_meta" WHERE key = 'app'`,
      );
      return r.rows[0]?.build_id ?? null;
    }),
};

async function main(argv: readonly string[]): Promise<void> {
  mkdirSync(RUN_DIR, { recursive: true });
  const [mode, ...rest] = argv;
  let journal: DeployJournal;
  if (mode === "--begin") {
    journal = parseBegin(rest);
  } else if (mode === "--resume") {
    const status = Number(rest[0]);
    if (!Number.isInteger(status)) usage("--resume needs the host status");
    journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as DeployJournal;
    completePendingEntry(journal, { status, output: readFileSync(0, "utf8") });
  } else {
    usage("expected --begin or --resume");
  }

  const save = (j: DeployJournal) =>
    writeFileReplacing(JOURNAL_PATH, `${JSON.stringify(j)}\n`);
  save(journal);
  const world = createJournaledWorld(journal, save, containerEffects);
  let action: string;
  try {
    const code = await runPonderDeploy(world, {
      operation: journal.operation,
      commit: journal.commit,
      repository: journal.repository,
    });
    action = `exit ${code}`;
  } catch (err) {
    if (err instanceof JournalDivergence) {
      process.stdout.write(`${err.message}\n`);
      process.exit(1);
    }
    if (!(err instanceof HostActionRequested)) throw err;
    action = err.action;
  }
  writeFileReplacing(ACTION_PATH, `${action}\n`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof JournalDivergence) {
    process.stdout.write(`${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
