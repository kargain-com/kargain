import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPassportPanelQuery,
  parsePassportPanel,
  passportPanelQueryString,
} from "../lib/passport/passport-panel-url.ts";

describe("passport-panel-url", () => {
  it("parsePassportPanel accepts actions and comments", () => {
    assert.equal(parsePassportPanel("actions"), "actions");
    assert.equal(parsePassportPanel("comments"), "comments");
    assert.equal(parsePassportPanel("records"), null);
    assert.equal(parsePassportPanel(null), null);
  });

  it("buildPassportPanelQuery sets panel and preserves other params", () => {
    const existing = new URLSearchParams("e=abc&chain=84532");
    const next = buildPassportPanelQuery("comments", existing);
    assert.equal(next.get("panel"), "comments");
    assert.equal(next.get("e"), "abc");
    assert.equal(next.get("chain"), "84532");
  });

  it("buildPassportPanelQuery clears panel when null", () => {
    const existing = new URLSearchParams("panel=actions&e=abc");
    const next = buildPassportPanelQuery(null, existing);
    assert.equal(next.get("panel"), null);
    assert.equal(next.get("e"), "abc");
  });

  it("passportPanelQueryString encodes panel", () => {
    assert.equal(passportPanelQueryString("actions"), "panel=actions");
    assert.equal(passportPanelQueryString(null), "");
  });
});
