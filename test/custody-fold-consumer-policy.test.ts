/**
 * HTTP + commerce consumers must use ponder-passport-custody owner (S7c-3).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const API_INDEX = path.join(ROOT, "src/api/index.ts");
const COMMERCE = path.join(ROOT, "src/api/commerce-routes.ts");
const QUERY_OWNER = path.join(ROOT, "src/lib/ponder-passport-custody.ts");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("custody fold consumer policy", () => {
  it("passport HTTP routes resolve via ponder-passport-custody", () => {
    const api = stripComments(fs.readFileSync(API_INDEX, "utf8"));
    assert.ok(api.includes("resolvePassportCustodyAnswer"));
    assert.ok(api.includes("resolvePassportCustodyAnswersBatch"));
    assert.ok(!api.includes("passport.custodyChain"));
  });

  it("commerce denorm has no origin fallback for custody", () => {
    const commerce = stripComments(fs.readFileSync(COMMERCE, "utf8"));
    assert.ok(commerce.includes("resolvePassportCustodyAnswersBatch"));
    assert.ok(!commerce.includes("custodyChain: p?.custodyChain"));
    assert.ok(!commerce.match(/custodyChain:\s*[^,\n]+\?\?\s*row\.chainId/));
    assert.ok(commerce.includes("custodyUnresolved"));
  });

  it("negative control — removing fold call would fail this pin", () => {
    const api = stripComments(fs.readFileSync(API_INDEX, "utf8"));
    const owner = stripComments(fs.readFileSync(QUERY_OWNER, "utf8"));
    assert.ok(api.includes("ponder-passport-custody"));
    assert.ok(owner.includes("foldPassportCustody"));
  });
});
