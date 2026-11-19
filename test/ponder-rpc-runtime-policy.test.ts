/**
 * Policy: commercial Ponder chains take ethGetLogsBlockRange + rpc list from env;
 * no URL literal fallback; no maxRequestsPerSecond.
 * Tracked tree: no singular PONDER_RPC_URL_<digits> except census local keys
 * and docs/ops/deploys/** / this suite.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PONDER_INDEXING_ENV_CENSUS } from "../scripts/lib/ponder-indexing-env-census.ts";
import {
  buildPonderRuntime,
  PonderEnvRefusalError,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
} from "../scripts/lib/ponder-env.ts";
import { listTrackedFiles } from "./policy-content-search.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PONDER_ENV = join(ROOT, "scripts/lib/ponder-env.ts");
const SELF_PATH = "test/ponder-rpc-runtime-policy.test.ts";
const PLANT_SCRIPT = "scripts/deploy.ts";

const HUB = 84532;
const SPOKE = 11155111;

const SINGULAR_RPC_RE = /PONDER_RPC_URL_(\d+)\b/g;

type SingularPonderRpcUrlHit = {
  path: string;
  line: number;
  key: string;
};

/** Allowed singular keys = census `local` entries matching PONDER_RPC_URL_<digits>. */
function allowedLocalSingularRpcKeys(
  census: typeof PONDER_INDEXING_ENV_CENSUS = PONDER_INDEXING_ENV_CENSUS,
): ReadonlySet<string> {
  return new Set(
    census
      .filter((e) => e.class === "local" && /^PONDER_RPC_URL_\d+$/.test(e.key))
      .map((e) => e.key),
  );
}

function findSingularPonderRpcUrlViolations(
  files: ReadonlyArray<{ path: string; source: string }>,
  opts: {
    allowedKeys: ReadonlySet<string>;
    selfPath: string;
  },
): SingularPonderRpcUrlHit[] {
  const hits: SingularPonderRpcUrlHit[] = [];
  for (const file of files) {
    if (file.path === opts.selfPath) continue;
    if (file.path.startsWith("docs/ops/deploys/")) continue;
    const lines = file.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      SINGULAR_RPC_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SINGULAR_RPC_RE.exec(line)) !== null) {
        const key = `PONDER_RPC_URL_${m[1]!}`;
        if (opts.allowedKeys.has(key)) continue;
        hits.push({ path: file.path, line: i + 1, key });
      }
    }
  }
  return hits;
}

function trackedSources(
  relPaths: readonly string[],
): Array<{ path: string; source: string }> {
  return relPaths.map((rel) => ({
    path: rel,
    source: readFileSync(join(ROOT, rel), "utf8"),
  }));
}

function withPlantedKey(
  files: ReadonlyArray<{ path: string; source: string }>,
  path: string,
  key: string,
): {
  planted: Array<{ path: string; source: string }>;
  plantLine: number;
} {
  const base = files.find((f) => f.path === path);
  assert.ok(base, `tracked set must include ${path}`);
  const plantLine = 1;
  const plantedSource = `const __plant = process.env.${key};\n${base.source}`;
  return {
    planted: files.map((f) =>
      f.path === path ? { path, source: plantedSource } : f,
    ),
    plantLine,
  };
}

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const keys = Object.keys(env);
  const prior = new Map<string, string | undefined>();
  for (const k of keys) {
    prior.set(k, process.env[k]);
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Ensure local-only paths stay off unless the test sets them.
  const localKeys = ["PONDER_ENABLE_LOCAL", "PONDER_LOCAL_ONLY"] as const;
  for (const k of localKeys) {
    if (!(k in env)) {
      prior.set(k, process.env[k]);
      delete process.env[k];
    }
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of prior) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const FIXTURE_DATABASE_URL =
  "postgresql://ponder:test@127.0.0.1:5432/kargain_ponder";

/** Empty dir outside the repo — no gitignored deployments/31337.json. */
const EMPTY_DEPLOYMENTS_DIR = mkdtempSync(
  join(tmpdir(), "kargain-rpc-runtime-empty-deploy-"),
);

/** Full local Hardhat address set for PONDER_ENABLE_LOCAL without a deploy file. */
const LOCAL_PONDER_ADDRESSES = {
  PONDER_KAR_PASSPORT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  PONDER_KAR_PRO_PASS_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  PONDER_KAR_PRO_STAKING_ADDRESS: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  PONDER_USDC_ADDRESS: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  PONDER_NATIVE_FEED_ADDRESS: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  PONDER_TIMELOCK_ADDRESS: "0x5FC8d32690ccbcdD12cb29731b7ebD4C41337A0F",
  PONDER_PLATFORM_RECIPIENT_ADDRESS:
    "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS:
    "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
  PONDER_ASCENDING_CONSIGNMENT_ADDRESS:
    "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe7",
  PONDER_BRIDGE_GATEWAY_ADDRESS: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
} as const;

const LOCAL_ADDRESS_KEYS = Object.keys(
  LOCAL_PONDER_ADDRESSES,
) as (keyof typeof LOCAL_PONDER_ADDRESSES)[];

function clearedLocalAddressEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of LOCAL_ADDRESS_KEYS) out[key] = undefined;
  return out;
}

function commercialEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: FIXTURE_DATABASE_URL,
    PONDER_DATABASE_URL: undefined,
    DATABASE_PRIVATE_URL: undefined,
    KARGAIN_DEPLOYMENTS_DIR: EMPTY_DEPLOYMENTS_DIR,
    ...clearedLocalAddressEnv(),
    [`PONDER_RPC_URLS_${HUB}`]: "https://base-sepolia.gateway.tenderly.co",
    [`PONDER_RPC_URLS_${SPOKE}`]: "https://rpc.sepolia.ethpandaops.io",
    [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: "50000",
    [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE}`]: "30000",
    ...extra,
  } as NodeJS.ProcessEnv;
}

function assertMissingDatabaseUrl(err: unknown): boolean {
  assert.ok(err instanceof PonderEnvRefusalError);
  assert.equal(err.code, "missing_database_url");
  assert.equal(err.envKey, "DATABASE_URL");
  return true;
}

describe("ponder-rpc-runtime-policy", () => {
  after(() => {
    rmSync(EMPTY_DEPLOYMENTS_DIR, { recursive: true, force: true });
  });

  it("commercial chains expose numeric ethGetLogsBlockRange and rpc string[] from env", () => {
    withEnv(commercialEnv(), () => {
      const { chains } = buildPonderRuntime();
      assert.ok(chains.baseSepolia);
      assert.ok(chains.ethereumSepolia);
      assert.equal(chains.baseSepolia.ethGetLogsBlockRange, 50000);
      assert.equal(chains.ethereumSepolia.ethGetLogsBlockRange, 30000);
      assert.deepEqual(chains.baseSepolia.rpc, [
        "https://base-sepolia.gateway.tenderly.co",
      ]);
      assert.deepEqual(chains.ethereumSepolia.rpc, [
        "https://rpc.sepolia.ethpandaops.io",
      ]);
      assert.equal(
        "maxRequestsPerSecond" in chains.baseSepolia,
        false,
      );
      assert.equal(
        "maxRequestsPerSecond" in chains.ethereumSepolia,
        false,
      );
    });
  });

  it("negative: non-local with only DATABASE_PRIVATE_URL refuses missing_database_url", () => {
    assert.throws(
      () =>
        withEnv(
          commercialEnv({
            DATABASE_URL: undefined,
            DATABASE_PRIVATE_URL:
              "postgresql://ponder:private@127.0.0.1:5432/kargain_ponder",
          }),
          () => buildPonderRuntime(),
        ),
      assertMissingDatabaseUrl,
    );
  });

  it("negative: non-local with only PONDER_DATABASE_URL refuses missing_database_url", () => {
    assert.throws(
      () =>
        withEnv(
          commercialEnv({
            DATABASE_URL: undefined,
            PONDER_DATABASE_URL:
              "postgresql://ponder:ponder@127.0.0.1:5432/kargain_ponder",
          }),
          () => buildPonderRuntime(),
        ),
      assertMissingDatabaseUrl,
    );
  });

  it("DATABASE_URL yields postgres with exactly that connection string", () => {
    withEnv(commercialEnv(), () => {
      assert.equal(process.env.KARGAIN_DEPLOYMENTS_DIR, EMPTY_DEPLOYMENTS_DIR);
      const { database } = buildPonderRuntime();
      assert.equal(database.kind, "postgres");
      if (database.kind !== "postgres") return;
      assert.equal(database.connectionString, FIXTURE_DATABASE_URL);
    });
  });

  it("local without DATABASE_URL yields pglite", () => {
    withEnv(
      commercialEnv({
        DATABASE_URL: undefined,
        PONDER_ENABLE_LOCAL: "1",
        ...LOCAL_PONDER_ADDRESSES,
      }),
      () => {
        assert.equal(process.env.KARGAIN_DEPLOYMENTS_DIR, EMPTY_DEPLOYMENTS_DIR);
        const { database } = buildPonderRuntime();
        assert.equal(database.kind, "pglite");
      },
    );
  });

  it("negative: missing getLogs window refuses by name", () => {
    assert.throws(
      () =>
        resolveGetLogsBlockRange(HUB, {
          [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: undefined,
        } as NodeJS.ProcessEnv),
      /missing_getlogs_block_range/,
    );
    assert.throws(
      () =>
        resolveGetLogsBlockRange(HUB, {
          [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: "0",
        } as NodeJS.ProcessEnv),
      /missing_getlogs_block_range/,
    );
  });

  it("negative: missing or empty RPC list refuses by name", () => {
    assert.throws(
      () =>
        resolveCommercialRpcUrls(HUB, {
          [`PONDER_RPC_URLS_${HUB}`]: undefined,
        } as NodeJS.ProcessEnv),
      /missing_rpc_urls/,
    );
    assert.throws(
      () =>
        resolveCommercialRpcUrls(HUB, {
          [`PONDER_RPC_URLS_${HUB}`]: "  ,  , ",
        } as NodeJS.ProcessEnv),
      /empty_rpc_urls/,
    );
  });

  it("negative: duplicate URL refuses by name", () => {
    assert.throws(
      () =>
        resolveCommercialRpcUrls(HUB, {
          [`PONDER_RPC_URLS_${HUB}`]:
            "https://a.example/rpc,https://a.example/rpc",
        } as NodeJS.ProcessEnv),
      /duplicate_rpc_url/,
    );
  });

  it("negative: ponder-env has no URL literal fallback for commercial RPC", () => {
    const src = readFileSync(PONDER_ENV, "utf8");
    assert.equal(
      /base-sepolia-rpc\.publicnode\.com/.test(src),
      false,
      "no publicnode Base fallback literal",
    );
    assert.equal(
      /ethereum-sepolia-rpc\.publicnode\.com/.test(src),
      false,
      "no publicnode Eth fallback literal",
    );
    assert.equal(
      /ETHEREUM_SEPOLIA_PUBLIC_RPC/.test(src),
      false,
      "no ETHEREUM_SEPOLIA_PUBLIC_RPC duplicate in ponder-env",
    );
    assert.equal(
      /\?\?[\s\n]*["']https:\/\//.test(src),
      false,
      "no ?? https URL fallback",
    );
  });

  it("tracked tree: no singular PONDER_RPC_URL_<digits> except census local", () => {
    const allowed = allowedLocalSingularRpcKeys();
    const tracked = listTrackedFiles(ROOT);
    assert.ok(
      tracked.includes("scripts/deploy.ts"),
      "scanned set must include scripts/deploy.ts",
    );
    assert.ok(
      tracked.includes("scripts/ponder-config.ts"),
      "scanned set must include scripts/ponder-config.ts",
    );
    const files = trackedSources(tracked);
    assert.deepEqual(
      findSingularPonderRpcUrlViolations(files, {
        allowedKeys: allowed,
        selfPath: SELF_PATH,
      }),
      [],
    );
  });

  it("negative: planted PONDER_RPC_URL_84532 in tracked deploy.ts copy is red then green", () => {
    const allowed = allowedLocalSingularRpcKeys();
    const tracked = listTrackedFiles(ROOT);
    assert.ok(tracked.includes(PLANT_SCRIPT));
    const files = trackedSources(tracked);
    const { planted, plantLine } = withPlantedKey(
      files,
      PLANT_SCRIPT,
      "PONDER_RPC_URL_84532",
    );
    assert.deepEqual(
      findSingularPonderRpcUrlViolations(planted, {
        allowedKeys: allowed,
        selfPath: SELF_PATH,
      }),
      [{ path: PLANT_SCRIPT, line: plantLine, key: "PONDER_RPC_URL_84532" }],
    );
    assert.deepEqual(
      findSingularPonderRpcUrlViolations(files, {
        allowedKeys: allowed,
        selfPath: SELF_PATH,
      }),
      [],
    );
  });

  it("negative: planted PONDER_RPC_URL_8453 in tracked deploy.ts copy is red", () => {
    const allowed = allowedLocalSingularRpcKeys();
    const tracked = listTrackedFiles(ROOT);
    assert.ok(tracked.includes(PLANT_SCRIPT));
    const files = trackedSources(tracked);
    const { planted, plantLine } = withPlantedKey(
      files,
      PLANT_SCRIPT,
      "PONDER_RPC_URL_8453",
    );
    assert.deepEqual(
      findSingularPonderRpcUrlViolations(planted, {
        allowedKeys: allowed,
        selfPath: SELF_PATH,
      }),
      [{ path: PLANT_SCRIPT, line: plantLine, key: "PONDER_RPC_URL_8453" }],
    );
  });

  it("negative: maxRequestsPerSecond and ponder-max-rps are gone", () => {
    const src = readFileSync(PONDER_ENV, "utf8");
    assert.equal(/maxRequestsPerSecond/.test(src), false);
    assert.equal(/ponder-max-rps/.test(src), false);
    assert.equal(/PONDER_MAX_RPS_/.test(src), false);
    assert.throws(
      () => readFileSync(join(ROOT, "scripts/lib/ponder-max-rps.ts")),
      /ENOENT/,
    );
  });
});
