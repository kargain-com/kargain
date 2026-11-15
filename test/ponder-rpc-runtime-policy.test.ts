/**
 * Policy: commercial Ponder chains take ethGetLogsBlockRange + rpc list from env;
 * no URL literal fallback; no maxRequestsPerSecond.
 * Tracked tree: no singular PONDER_RPC_URL_<digits> except census local keys
 * and docs/ops/deploys/** / this suite.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PONDER_INDEXING_ENV_CENSUS } from "../scripts/lib/ponder-indexing-env-census.ts";
import {
  buildPonderRuntime,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
} from "../scripts/lib/ponder-env.ts";
import { listTrackedFiles } from "./policy-content-search.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PONDER_ENV = join(ROOT, "scripts/lib/ponder-env.ts");
const SELF_PATH = "test/ponder-rpc-runtime-policy.test.ts";

const HUB = 84532;
const SPOKE = 11155111;

const SINGULAR_RPC_RE = /PONDER_RPC_URL_(\d+)\b/g;

export type SingularPonderRpcUrlHit = {
  path: string;
  line: number;
  key: string;
};

/** Allowed singular keys = census `local` entries matching PONDER_RPC_URL_<digits>. */
export function allowedLocalSingularRpcKeys(
  census: typeof PONDER_INDEXING_ENV_CENSUS = PONDER_INDEXING_ENV_CENSUS,
): ReadonlySet<string> {
  return new Set(
    census
      .filter((e) => e.class === "local" && /^PONDER_RPC_URL_\d+$/.test(e.key))
      .map((e) => e.key),
  );
}

export function findSingularPonderRpcUrlViolations(
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

function commercialEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    [`PONDER_RPC_URLS_${HUB}`]: "https://base-sepolia.gateway.tenderly.co",
    [`PONDER_RPC_URLS_${SPOKE}`]: "https://rpc.sepolia.ethpandaops.io",
    [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: "50000",
    [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE}`]: "30000",
    ...extra,
  } as NodeJS.ProcessEnv;
}

describe("ponder-rpc-runtime-policy", () => {
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
    const files = trackedSources(listTrackedFiles(ROOT));
    assert.deepEqual(
      findSingularPonderRpcUrlViolations(files, {
        allowedKeys: allowed,
        selfPath: SELF_PATH,
      }),
      [],
    );
  });

  it("negative: planted PONDER_RPC_URL_84532 in temp tracked copy is red then green", () => {
    const allowed = allowedLocalSingularRpcKeys();
    const dir = mkdtempSync(join(tmpdir(), "kargain-singular-rpc-"));
    try {
      const rel = "scripts/planted-singular-rpc.ts";
      const plantedSource =
        'const x = process.env.PONDER_RPC_URL_84532 ?? "";\n';
      writeFileSync(join(dir, "planted.ts"), plantedSource);
      const planted = [{ path: rel, source: plantedSource }];
      const hits = findSingularPonderRpcUrlViolations(planted, {
        allowedKeys: allowed,
        selfPath: SELF_PATH,
      });
      assert.equal(hits.length, 1);
      assert.equal(hits[0]?.path, rel);
      assert.equal(hits[0]?.line, 1);
      assert.equal(hits[0]?.key, "PONDER_RPC_URL_84532");

      const clean = [
        { path: rel, source: 'const x = process.env.PONDER_RPC_URLS_84532 ?? "";\n' },
      ];
      assert.deepEqual(
        findSingularPonderRpcUrlViolations(clean, {
          allowedKeys: allowed,
          selfPath: SELF_PATH,
        }),
        [],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("negative: planted PONDER_RPC_URL_8453 (id not in registry) is red", () => {
    const allowed = allowedLocalSingularRpcKeys();
    const planted = [
      {
        path: "scripts/planted-odd-id.ts",
        source: "export const k = \"PONDER_RPC_URL_8453\";\n",
      },
    ];
    const hits = findSingularPonderRpcUrlViolations(planted, {
      allowedKeys: allowed,
      selfPath: SELF_PATH,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "scripts/planted-odd-id.ts");
    assert.equal(hits[0]?.line, 1);
    assert.equal(hits[0]?.key, "PONDER_RPC_URL_8453");
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
