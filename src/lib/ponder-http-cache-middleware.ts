/**
 * Sole owner of Ponder Hono response Cache-Control + ETag (+ 304).
 * Register on `app` before any routes. Freshness classes live in
 * `ponder-http-freshness.ts` (indexer→edge; not Truth T1–T6).
 */

import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";

import {
  cacheControlForClass,
  httpFreshnessClassForRoutePath,
} from "./ponder-http-freshness";

function weakEtag(body: ArrayBuffer): string {
  const hex = createHash("sha256").update(Buffer.from(body)).digest("hex");
  return `W/"${hex}"`;
}

/** True when If-None-Match lists this etag (weak comparison). */
export function ifNoneMatchMatches(
  ifNoneMatch: string,
  etag: string,
): boolean {
  if (ifNoneMatch.trim() === "*") return true;
  const target = etag.replace(/^W\//i, "").replaceAll('"', "").toLowerCase();
  for (const part of ifNoneMatch.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (token === "*") return true;
    const candidate = token
      .replace(/^W\//i, "")
      .replaceAll('"', "")
      .toLowerCase();
    if (candidate === target) return true;
  }
  return false;
}

/**
 * Hono sets `routePath` to the middleware pattern (`/*`) until `next()`;
 * after handlers run, prefer the last matched non-middleware GET path.
 */
export function matchedHonoGetPath(
  routePath: string,
  matchedRoutes: readonly { path: string; method: string }[],
): string | undefined {
  for (let i = matchedRoutes.length - 1; i >= 0; i--) {
    const r = matchedRoutes[i]!;
    if (r.method === "GET" && r.path !== "/*") return r.path;
  }
  if (routePath && routePath !== "*") return routePath;
  return undefined;
}

export const ponderHttpCacheMiddleware = createMiddleware(async (c, next) => {
  await next();

  if (c.req.method !== "GET" && c.req.method !== "HEAD") return;

  const routePath = matchedHonoGetPath(c.req.routePath, c.req.matchedRoutes);
  if (!routePath) return;

  const classId = httpFreshnessClassForRoutePath(routePath);
  if (classId === undefined) {
    // Matched a Hono route with no freshness class — error, not silent long TTL.
    c.res = new Response("Missing HTTP freshness class for route", {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
    return;
  }

  const status = c.res.status;
  const cacheControl = cacheControlForClass(classId);

  if (status !== 200 && status !== 404) {
    const headers = new Headers(c.res.headers);
    headers.set("Cache-Control", cacheControl);
    c.res = new Response(c.res.body, { status, headers });
    return;
  }

  const body = await c.res.arrayBuffer();
  const etag = weakEtag(body);

  const inm = c.req.header("If-None-Match");
  if (inm && status === 200 && ifNoneMatchMatches(inm, etag)) {
    c.res = new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": cacheControl,
      },
    });
    return;
  }

  const headers = new Headers(c.res.headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", cacheControl);
  headers.delete("Content-Length");

  c.res = new Response(body, { status, headers });
});
