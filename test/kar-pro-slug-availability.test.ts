import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isValidSlug,
  slugFormatStatus,
  slugify,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
} from "../lib/kar-pro/kar-pro-slug-rules.ts";
import {
  deriveSlugAvailabilityStatus,
  fetchSlugAvailability,
  mapSlugAvailabilityResult,
  resolvePonderApiBaseUrl,
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

describe("slug-availability mapping", () => {
  it("resolvePonderApiBaseUrl trims and falls back", () => {
    assert.equal(resolvePonderApiBaseUrl(undefined), "http://localhost:42069");
    assert.equal(resolvePonderApiBaseUrl(""), "http://localhost:42069");
    assert.equal(resolvePonderApiBaseUrl("   "), "http://localhost:42069");
    assert.equal(
      resolvePonderApiBaseUrl("https://ponder.kargain.com/"),
      "https://ponder.kargain.com",
    );
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

  it("fetchSlugAvailability maps ponder responses", async () => {
    assert.deepEqual(await fetchSlugAvailability({ slug: "ab" }), {
      available: false,
      reason: "invalid_format",
    });

    const available = await fetchSlugAvailability({
      slug: "testdealer",
      ponderBaseUrl: "https://ponder.test",
      fetchImpl: async (input) => {
        assert.equal(
          String(input),
          "https://ponder.test/verifiers/slug-available/testdealer",
        );
        return new Response(JSON.stringify({ available: true, slug: "testdealer" }), {
          status: 200,
        });
      },
    });
    assert.deepEqual(available, { available: true });

    const taken = await fetchSlugAvailability({
      slug: "taken-slug",
      ownerAddress: "0xAbc",
      ponderBaseUrl: "https://ponder.test",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.searchParams.get("address"), "0xAbc");
        return new Response(JSON.stringify({ available: false, slug: "taken-slug" }), {
          status: 200,
        });
      },
    });
    assert.deepEqual(taken, { available: false, reason: "taken" });

    const upstreamError = await fetchSlugAvailability({
      slug: "hello-world",
      ponderBaseUrl: "https://ponder.test",
      fetchImpl: async () => new Response("nope", { status: 502 }),
    });
    assert.deepEqual(upstreamError, { available: false, reason: "error" });
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
