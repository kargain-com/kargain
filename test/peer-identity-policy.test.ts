import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("peer identity KarPro policy", () => {
  it("does not default peer Pro to wallet commercial target", () => {
    const src = readFileSync(join(root, "hooks/use-peer-identity.ts"), "utf8");
    assert.equal(
      src.includes("resolveKarProTargetChainId"),
      false,
      "peer Pro must not use viewer wallet commercial target",
    );
    assert.match(src, /useKarProMembershipRoster/);
    assert.match(src, /karProAnyActive/);
    assert.match(src, /isCommercialChainId/);
  });

  it("agent authorization passes mandate chainId into usePeerIdentity", () => {
    const src = readFileSync(
      join(root, "components/marketplace/agent-authorization-status.tsx"),
      "utf8",
    );
    assert.match(src, /usePeerIdentity\(mandate\.agent,\s*\{\s*chainId/);
  });

  it("Commons reviews/confirmations consume shared membership active gate", () => {
    const reviews = readFileSync(join(root, "hooks/use-commons-reviews.ts"), "utf8");
    const confirmations = readFileSync(
      join(root, "hooks/use-commons-confirmations.ts"),
      "utf8",
    );
    assert.match(reviews, /useKarProMembershipActive/);
    assert.match(confirmations, /useKarProMembershipActive/);
    assert.equal(reviews.includes("OR across commercial"), false);
    assert.equal(confirmations.includes("OR across commercial"), false);
  });
});
