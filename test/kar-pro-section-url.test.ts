import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildKarProSectionQuery,
  karProSectionQueryString,
  parseKarProSection,
} from "../lib/kar-pro/kar-pro-section-url.ts";

describe("kar-pro-section-url", () => {
  it("parseKarProSection defaults to overview", () => {
    assert.equal(parseKarProSection(null), "overview");
    assert.equal(parseKarProSection("overview"), "overview");
    assert.equal(parseKarProSection("profile"), "profile");
    assert.equal(parseKarProSection("fee"), "fee");
    assert.equal(parseKarProSection("payments"), "payments");
    assert.equal(parseKarProSection("account"), "account");
    assert.equal(parseKarProSection("unknown"), "overview");
  });

  it("buildKarProSectionQuery sets section", () => {
    const existing = new URLSearchParams("foo=bar");
    const next = buildKarProSectionQuery("fee", existing);
    assert.equal(next.get("section"), "fee");
    assert.equal(next.get("foo"), "bar");
  });

  it("buildKarProSectionQuery clears section for overview", () => {
    const existing = new URLSearchParams("section=profile");
    const next = buildKarProSectionQuery("overview", existing);
    assert.equal(next.get("section"), null);
  });

  it("karProSectionQueryString encodes section", () => {
    assert.equal(karProSectionQueryString("overview"), "");
    assert.equal(karProSectionQueryString("payments"), "section=payments");
  });
});
