import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPassportTabQuery,
  parsePassportTab,
  passportTabQueryString,
} from "../lib/passport/passport-tab-url.ts";

describe("passport-tab-url", () => {
  it("parsePassportTab defaults to overview", () => {
    assert.equal(parsePassportTab(null), "overview");
    assert.equal(parsePassportTab("records"), "records");
    assert.equal(parsePassportTab("actions"), "actions");
    assert.equal(parsePassportTab("unknown"), "overview");
  });

  it("buildPassportTabQuery sets tab and clears legacy panel", () => {
    const existing = new URLSearchParams("panel=records&e=abc");
    const next = buildPassportTabQuery("actions", existing);
    assert.equal(next.get("tab"), "actions");
    assert.equal(next.get("panel"), null);
    assert.equal(next.get("e"), "abc");
  });

  it("buildPassportTabQuery clears tab for overview", () => {
    const existing = new URLSearchParams("tab=records");
    const next = buildPassportTabQuery("overview", existing);
    assert.equal(next.get("tab"), null);
  });

  it("passportTabQueryString encodes tab", () => {
    assert.equal(passportTabQueryString("overview"), "");
    assert.equal(passportTabQueryString("records"), "tab=records");
  });
});

