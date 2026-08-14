/**
 * Cache-Control + ETag + If-None-Match → 304 for Ponder Hono middleware.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import {
  ifNoneMatchMatches,
  ponderHttpCacheMiddleware,
} from "../src/lib/ponder-http-cache-middleware.ts";
import { HTTP_FRESHNESS_CLASSES } from "../src/lib/ponder-http-freshness.ts";

function testApp(): Hono {
  const app = new Hono();
  app.use("*", ponderHttpCacheMiddleware);
  app.get("/commerce-modes", (c) => c.json({ modes: [{ id: "fixed" }] }));
  app.get("/consignments", (c) => c.json({ consignments: [], total: 0 }));
  app.get("/verifiers/slug-available/:slug", (c) =>
    c.json({ available: true, slug: c.req.param("slug") }),
  );
  app.get("/unclassified-probe", (c) => c.json({ leak: true }));
  return app;
}

describe("ponder HTTP cache middleware", () => {
  it("sets config Cache-Control and ETag on 200", async () => {
    const res = await testApp().request("/commerce-modes");
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("cache-control"),
      HTTP_FRESHNESS_CLASSES.config.cacheControl,
    );
    const etag = res.headers.get("etag");
    assert.ok(etag?.startsWith('W/"'));
    const body = await res.json();
    assert.deepEqual(body, { modes: [{ id: "fixed" }] });
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    const app = testApp();
    const first = await app.request("/consignments");
    assert.equal(first.status, 200);
    assert.equal(
      first.headers.get("cache-control"),
      HTTP_FRESHNESS_CLASSES.catalog.cacheControl,
    );
    const etag = first.headers.get("etag");
    assert.ok(etag);

    const second = await app.request("/consignments", {
      headers: { "If-None-Match": etag },
    });
    assert.equal(second.status, 304);
    assert.equal(second.headers.get("etag"), etag);
    assert.equal(
      second.headers.get("cache-control"),
      HTTP_FRESHNESS_CLASSES.catalog.cacheControl,
    );
    assert.equal(await second.text(), "");
  });

  it("returns 304 for weak-tag list forms of If-None-Match", async () => {
    const app = testApp();
    const first = await app.request("/commerce-modes");
    const etag = first.headers.get("etag")!;
    const strongForm = etag.replace(/^W\//, "");
    const third = await app.request("/commerce-modes", {
      headers: { "If-None-Match": `${strongForm}, "other"` },
    });
    assert.equal(third.status, 304);
  });

  it("ephemeral class uses private no-store", async () => {
    const res = await testApp().request("/verifiers/slug-available/acme");
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("cache-control"),
      HTTP_FRESHNESS_CLASSES.ephemeral.cacheControl,
    );
    assert.ok(res.headers.get("etag"));
  });

  it("matched route without freshness class fails closed (500)", async () => {
    const res = await testApp().request("/unclassified-probe");
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });

  it("ifNoneMatchMatches weak comparison", () => {
    const etag = 'W/"abc"';
    assert.equal(ifNoneMatchMatches(etag, etag), true);
    assert.equal(ifNoneMatchMatches('"abc"', etag), true);
    assert.equal(ifNoneMatchMatches('W/"abc", W/"def"', etag), true);
    assert.equal(ifNoneMatchMatches('W/"zzz"', etag), false);
    assert.equal(ifNoneMatchMatches("*", etag), true);
  });
});
