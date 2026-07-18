import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proConsignmentsHref } from "../lib/kar-pro/pro-consignments-href.ts";

describe("proConsignmentsHref", () => {
  it("builds the public Pro consignments catalog path", () => {
    assert.equal(proConsignmentsHref("acme-motors"), "/pro/acme-motors/consignments");
  });

  it("encodes slug characters for a safe path segment", () => {
    assert.equal(
      proConsignmentsHref("acme motors"),
      "/pro/acme%20motors/consignments",
    );
  });

  it("never deep-links guests to the private Consigned profile tab", () => {
    const href = proConsignmentsHref("acme-motors");
    assert.equal(href.includes("tab=consigned"), false);
    assert.equal(href.includes("/profile/"), false);
    assert.match(href, /^\/pro\/[^/]+\/consignments$/);
  });
});
