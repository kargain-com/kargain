import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isValidSlug,
  slugFormatStatus,
  slugify,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
} from "../lib/kar-pro/kar-pro-slug-rules.ts";
import {
  buildSlugAvailablePath,
  deriveSlugAvailabilityStatus,
  mapSlugAvailabilityResult,
  slugAvailabilityFromPonderPayload,
} from "../lib/kar-pro/slug-availability.ts";

describe("kar-pro-slug-rules", () => {
  it("slugify normalizes names", () => {
    assert.equal(slugify("  Hello World!  "), "hello-world");
    assert.equal(slugify("Foo---Bar"), "foo-bar");
    assert.equal(slugify("@@@"), "");
  });

  it("isValidSlug enforces length and pattern", () => {
    assert.equal(isValidSlug("ab"), false);
    assert.equal(isValidSlug("abc"), true);
    assert.equal(isValidSlug("hello-world"), true);
    assert.equal(isValidSlug("-leading"), false);
    assert.equal(isValidSlug("trailing-"), false);
    assert.equal(isValidSlug("Upper"), false);
    assert.equal(isValidSlug("a".repeat(SLUG_MAX_LENGTH)), true);
    assert.equal(isValidSlug("a".repeat(SLUG_MAX_LENGTH + 1)), false);
    assert.equal(SLUG_MIN_LENGTH, 3);
  });

  it("slugFormatStatus gates sync UI", () => {
    assert.equal(slugFormatStatus(""), "idle");
    assert.equal(slugFormatStatus("  "), "idle");
    assert.equal(slugFormatStatus("ab"), "invalid_format");
    assert.equal(slugFormatStatus("hello-world"), "ready");
  });
});

describe("slug-availability pure helpers", () => {
  it("client-safe module has no process.env or fetch", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../lib/kar-pro/slug-availability.ts"),
      "utf8",
    );
    assert.equal(source.includes("process.env"), false);
    assert.equal(/\bfetch\s*\(/.test(source), false);
  });

  it("kar-pro server actions do not re-export types", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    for (const rel of [
      "app/actions/kar-pro-slug.ts",
      "app/actions/vincent-commons.ts",
      "app/actions/kar-pro-verifier.ts",
    ]) {
      const source = readFileSync(join(root, rel), "utf8");
      assert.equal(
        /^export type\b/m.test(source),
        false,
        `${rel} must not export types from a "use server" module`,
      );
    }
  });

  it("buildSlugAvailablePath encodes slug and optional address", () => {
    assert.equal(
      buildSlugAvailablePath("testdealer"),
      "/verifiers/slug-available/testdealer",
    );
    assert.equal(
      buildSlugAvailablePath("taken-slug", "0xAbc"),
      "/verifiers/slug-available/taken-slug?address=0xAbc",
    );
  });

  it("slugAvailabilityFromPonderPayload maps wire bodies", () => {
    assert.deepEqual(slugAvailabilityFromPonderPayload({ available: true }), {
      available: true,
    });
    assert.deepEqual(slugAvailabilityFromPonderPayload({ available: false }), {
      available: false,
      reason: "taken",
    });
    assert.deepEqual(slugAvailabilityFromPonderPayload({}), {
      available: false,
      reason: "taken",
    });
  });

  it("mapSlugAvailabilityResult covers wire reasons", () => {
    assert.equal(mapSlugAvailabilityResult({ available: true }), "available");
    assert.equal(
      mapSlugAvailabilityResult({ available: false, reason: "taken" }),
      "taken",
    );
    assert.equal(
      mapSlugAvailabilityResult({ available: false, reason: "invalid_format" }),
      "invalid_format",
    );
    assert.equal(
      mapSlugAvailabilityResult({ available: false, reason: "invalid_length" }),
      "invalid_format",
    );
    assert.equal(
      mapSlugAvailabilityResult({ available: false, reason: "error" }),
      "error",
    );
    assert.equal(mapSlugAvailabilityResult({ available: false }), "taken");
  });

  it("deriveSlugAvailabilityStatus prefers format, then debounce, then query", () => {
    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "",
        debouncedSlug: "",
        querySlug: undefined,
        queryStatus: undefined,
        isFetching: false,
        isError: false,
      }),
      "idle",
    );

    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "ab",
        debouncedSlug: "ab",
        querySlug: undefined,
        queryStatus: undefined,
        isFetching: false,
        isError: false,
      }),
      "invalid_format",
    );

    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "hello-world",
        debouncedSlug: "hello",
        querySlug: undefined,
        queryStatus: undefined,
        isFetching: false,
        isError: false,
      }),
      "checking",
    );

    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "hello-world",
        debouncedSlug: "hello-world",
        querySlug: undefined,
        queryStatus: undefined,
        isFetching: true,
        isError: false,
      }),
      "checking",
    );

    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "hello-world",
        debouncedSlug: "hello-world",
        querySlug: "hello-world",
        queryStatus: "available",
        isFetching: false,
        isError: false,
      }),
      "available",
    );

    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "hello-world",
        debouncedSlug: "hello-world",
        querySlug: "other-slug",
        queryStatus: "available",
        isFetching: false,
        isError: false,
      }),
      "checking",
    );

    assert.equal(
      deriveSlugAvailabilityStatus({
        slug: "hello-world",
        debouncedSlug: "hello-world",
        querySlug: undefined,
        queryStatus: undefined,
        isFetching: false,
        isError: true,
      }),
      "error",
    );
  });
});
