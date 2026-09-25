/**
 * Route resolver + crossing-route admit are the sole owners of star membership
 * and hop sequences. Ban a second counterpart map / invented refusal sentence.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";
import {
  BRIDGE_CROSSING_ROUTE_CAUSES,
  EID_BY_CHAIN,
  admitBridgeCrossingRoute,
  bridgeCrossingRouteCauseCopy,
} from "../lib/web3/bridge/bridge-config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OWNER = path.join(ROOT, "lib/web3/bridge/bridge-config.ts");

const SCAN_DIRS = [
  path.join(ROOT, "lib"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "components"),
] as const;

const COUNTERPART_MAP =
  /(?:const|let|var)\s+\w*(COUNTERPART|counterpartChains?|STAR_REMOTE)\w*/;

const ROUTE_SENTENCE = "This network has no bridge crossing route.";

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("bridge route resolver policy", () => {
  it("owning module exports resolveBridgeRoute, admit, and has no hub default on adapter", () => {
    const text = fs.readFileSync(OWNER, "utf8");
    assert.match(text, /export function resolveBridgeRoute/);
    assert.match(text, /export function admitBridgeCrossingRoute/);
    assert.match(text, /export function bridgeCrossingRouteCauseCopy/);
    assert.doesNotMatch(
      text,
      /function bridgeAdapterAddress\s*\(\s*chainId:\s*number\s*=\s*BRIDGE_HUB_CHAIN_ID/,
    );
    assert.doesNotMatch(text, /(?:const|let)\s+COUNTERPART\b/);
  });

  it("no second counterpart map under lib/ hooks/ components/", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === OWNER) continue;
        const text = fs.readFileSync(file, "utf8");
        if (COUNTERPART_MAP.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
        if (/export function resolveBridgeRoute/.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
        if (/export function admitBridgeCrossingRoute/.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("admit: star configured; Solana / non-star absent no_crossing_route", () => {
    assert.deepEqual(admitBridgeCrossingRoute(84532), {
      status: "configured",
      namespace: 84532,
    });
    assert.deepEqual(admitBridgeCrossingRoute(11155111), {
      status: "configured",
      namespace: 11155111,
    });
    assert.deepEqual(admitBridgeCrossingRoute(2000040168), {
      status: "absent",
      cause: "no_crossing_route",
      namespace: 2000040168,
    });
    assert.deepEqual(admitBridgeCrossingRoute(null), {
      status: "absent",
      cause: "unresolved_namespace",
    });
  });

  it("sole sentence for no_crossing_route; causes closed", () => {
    assert.deepEqual([...BRIDGE_CROSSING_ROUTE_CAUSES], ["no_crossing_route"]);
    assert.equal(
      bridgeCrossingRouteCauseCopy("no_crossing_route"),
      ROUTE_SENTENCE,
    );
  });

  it("EID_BY_CHAIN stays exactly hub+spoke — plant Solana EID is red", () => {
    const keys = Object.keys(EID_BY_CHAIN).map(Number).sort((a, b) => a - b);
    assert.deepEqual(keys, [84532, 11155111]);
    assert.equal(Object.prototype.hasOwnProperty.call(EID_BY_CHAIN, 2000040168), false);
    // plant: invent Solana into the star
    const planted = { ...EID_BY_CHAIN, 2000040168: 40168 };
    assert.notDeepEqual(
      Object.keys(planted).map(Number).sort((a, b) => a - b),
      [84532, 11155111],
    );
  });

  it("product tree never re-inlines crossing-route sentence (planted copy red then green)", () => {
    const owners = ["lib/web3/bridge/bridge-config.ts"];
    const findHit = (_rel: string, source: string): string | false => {
      if (source.includes(JSON.stringify(ROUTE_SENTENCE))) {
        return `re-inlined no_crossing_route sentence (sole owner: bridgeCrossingRouteCauseCopy): ${ROUTE_SENTENCE}`;
      }
      return false;
    };
    assertCleanProductScan(scanProductSources(findHit, { owners }), { owners });
    const planted = `export const bad = ${JSON.stringify(ROUTE_SENTENCE)};\n`;
    assert.equal(findHit("components/passport/passport-bridge-panel.tsx", planted) !== false, true);
    assert.throws(
      () =>
        assertCleanProductScan(
          {
            filesRead: 1,
            violations: [
              {
                path: "components/passport/passport-bridge-panel.tsx",
                reason: findHit(
                  "components/passport/passport-bridge-panel.tsx",
                  planted,
                ) as string,
              },
            ],
            unreadable: [],
          },
          { owners },
        ),
      /re-inlined no_crossing_route sentence/,
    );
  });
});
