import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  buildPassportTabQuery,
  parsePassportTab,
  passportTabQueryString,
  revealPassportRecordsTab,
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

  describe("revealPassportRecordsTab", () => {
    const prior = (globalThis as { window?: unknown }).window;

    afterEach(() => {
      if (prior === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          writable: true,
          value: prior,
        });
      }
    });

    it("sets tab=records and preserves other query params", () => {
      let replaced = "";
      let dispatched = false;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: {
          location: { search: "?e=abc&chain=84532" },
          history: {
            state: null,
            replaceState(_state: unknown, _title: string, url: string) {
              replaced = url;
            },
          },
          dispatchEvent(event: Event) {
            if (event.type === "passport-tab-change") dispatched = true;
            return true;
          },
        },
      });

      revealPassportRecordsTab("/marketplace/1");

      assert.equal(replaced, "/marketplace/1?e=abc&chain=84532&tab=records");
      assert.equal(dispatched, true);
    });
  });
});
