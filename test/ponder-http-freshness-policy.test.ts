/**
 * Every Hono GET path must have exactly one HTTP freshness class.
 * Classes are indexer→edge (not Truth T1–T6).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PONDER_IMPLEMENTED_ROUTES } from "../lib/web3/ponder-endpoints.ts";
import {
  HONO_ROUTE_HTTP_FRESHNESS,
  HTTP_FRESHNESS_CLASSES,
} from "../src/lib/ponder-http-freshness.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readApiSources(): string {
  return (
    fs.readFileSync(path.join(ROOT, "src/api/index.ts"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(ROOT, "src/api/commerce-routes.ts"), "utf8")
  );
}

function registeredHonoPaths(source: string): Set<string> {
  const paths = new Set<string>();
  const re = /app\.get\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    paths.add(m[1]!);
  }
  return paths;
}

describe("ponder HTTP freshness policy", () => {
  it("freshness class ids do not use a T prefix (no collision with T1–T6)", () => {
    for (const id of Object.keys(HTTP_FRESHNESS_CLASSES)) {
      assert.ok(
        !/^T/i.test(id),
        `freshness class "${id}" must not look like Truth layer T*`,
      );
    }
  });

  it("protocol projections have zero edge TTL until Phase 3 invalidation", () => {
    for (const id of ["catalog", "entity", "account"] as const) {
      const cc = HTTP_FRESHNESS_CLASSES[id].cacheControl;
      assert.match(cc, /s-maxage=0\b/, `${id} must pin s-maxage=0`);
      assert.doesNotMatch(
        cc,
        /stale-while-revalidate/,
        `${id} must not advertise SWR before event purge`,
      );
      assert.doesNotMatch(
        cc,
        /s-maxage=[1-9]/,
        `${id} must not have positive s-maxage before Phase 3`,
      );
    }
    assert.match(
      HTTP_FRESHNESS_CLASSES.config.cacheControl,
      /s-maxage=300\b/,
      "config may keep shared TTL (chain-gated actions)",
    );
  });

  it("every registered Hono GET path has exactly one freshness class", () => {
    const registered = registeredHonoPaths(readApiSources());
    const mapped = HONO_ROUTE_HTTP_FRESHNESS.map((e) => e.path);
    const mappedSet = new Set(mapped);

    assert.equal(
      mapped.length,
      mappedSet.size,
      "duplicate path in HONO_ROUTE_HTTP_FRESHNESS",
    );

    const missing = [...registered].filter((p) => !mappedSet.has(p)).sort();
    const orphan = [...mappedSet].filter((p) => !registered.has(p)).sort();

    assert.deepEqual(
      { missing, orphan },
      { missing: [], orphan: [] },
      "Hono routes and HONO_ROUTE_HTTP_FRESHNESS must match exactly",
    );
  });

  it("every hono catalog route has a freshness class", () => {
    const byPath = new Map(
      HONO_ROUTE_HTTP_FRESHNESS.map((e) => [e.path, e.classId]),
    );
    const missing: string[] = [];
    for (const route of PONDER_IMPLEMENTED_ROUTES) {
      if (route.registration === "ponder-reserved") continue;
      if (!byPath.has(route.path)) {
        missing.push(`${route.id}: ${route.path}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("index.ts registers cache middleware before routes", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/api/index.ts"), "utf8");
    const mw = src.indexOf("app.use(\"*\", ponderHttpCacheMiddleware)");
    const firstGet = src.search(/app\.get\(/);
    const register = src.indexOf("registerCommerceRoutes(app)");
    assert.ok(mw >= 0, "middleware registration missing");
    assert.ok(register >= 0, "registerCommerceRoutes missing");
    assert.ok(mw < register, "middleware must run before registerCommerceRoutes");
    assert.ok(mw < firstGet, "middleware must run before first app.get");
  });
});
