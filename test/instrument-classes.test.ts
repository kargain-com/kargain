import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  browsePrice,
  categoryLabel,
  ctaLink,
  instrumentClasses,
  monoLink,
  serialLabel,
  shellControlHover,
  trustStampBase,
  trustStampKarPro,
  trustStampVerified,
  sectionScrollAnchor,
} from "../lib/design/instrument-classes.ts";

describe("instrument-classes", () => {
  it("exports non-empty canonical strings", () => {
    for (const value of Object.values(instrumentClasses)) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
    }
  });

  it("serialLabel matches §10.1 serial typography", () => {
    assert.match(serialLabel, /tracking-\[0\.18em\]/);
    assert.match(serialLabel, /text-text-tertiary/);
    assert.match(serialLabel, /uppercase/);
  });

  it("monoLink uses accent on hover/focus only", () => {
    assert.match(monoLink, /hover:text-accent-warm/);
    assert.match(monoLink, /focus-visible:text-accent-warm/);
    const withoutInteraction = monoLink.replace(
      /hover:text-accent-warm|focus-visible:text-accent-warm/g,
      "",
    );
    assert.doesNotMatch(withoutInteraction, /text-accent-warm/);
  });

  it("browsePrice uses tabular-nums", () => {
    assert.match(browsePrice, /tabular-nums/);
    assert.match(browsePrice, /text-text-primary/);
  });

  it("categoryLabel matches serialLabel", () => {
    assert.equal(categoryLabel, serialLabel);
  });

  it("ctaLink allows accent at rest per §12.3.1", () => {
    assert.match(ctaLink, /text-accent-warm/);
    assert.match(ctaLink, /hover:text-text-primary/);
  });

  it("shellControlHover avoids accent border", () => {
    assert.match(shellControlHover, /hover:border-border-hover/);
    assert.doesNotMatch(shellControlHover, /accent-warm/);
  });

  it("trustStampBase uses squared registration stamp shape", () => {
    assert.match(trustStampBase, /rounded-sm/);
    assert.match(trustStampBase, /tracking-\[0\.18em\]/);
    assert.doesNotMatch(trustStampBase, /rounded-full/);
    assert.doesNotMatch(trustStampBase, /shadow/);
  });

  it("trustStamp variants use status chroma only", () => {
    assert.match(trustStampVerified, /border-accent-warm/);
    assert.match(trustStampKarPro, /border-accent-warm\/40/);
    assert.doesNotMatch(trustStampKarPro, /shadow/);
  });

  it("sectionScrollAnchor offsets for mobile FAB", () => {
    assert.match(sectionScrollAnchor, /scroll-mt-28/);
    assert.match(sectionScrollAnchor, /md:scroll-mt-24/);
  });
});
