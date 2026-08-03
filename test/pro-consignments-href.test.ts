import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proConsignmentsHref, proShowroomHref } from "../lib/kar-pro/pro-showroom-href.ts";

const HUB = 84532;

describe("proShowroomHref / proConsignmentsHref", () => {
  it("builds showroom and consignments paths with chain", () => {
    assert.equal(proShowroomHref("acme-motors", HUB), `/pro/acme-motors?chain=${HUB}`);
    assert.equal(
      proConsignmentsHref("acme-motors", HUB),
      `/pro/acme-motors/consignments?chain=${HUB}`,
    );
  });

  it("encodes slug characters for a safe path segment", () => {
    assert.equal(
      proConsignmentsHref("acme motors", HUB),
      `/pro/acme%20motors/consignments?chain=${HUB}`,
    );
  });

  it("never deep-links guests to the private Consigned profile tab", () => {
    const href = proConsignmentsHref("acme-motors", HUB);
    assert.equal(href.includes("tab=consigned"), false);
    assert.equal(href.includes("/profile/"), false);
    assert.match(href, /^\/pro\/[^/]+\/consignments\?chain=\d+$/);
  });
});
