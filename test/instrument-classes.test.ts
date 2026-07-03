import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  browsePrice,
  categoryLabel,
  commerceConfirmedLabel,
  commerceConfirmedPanel,
  ctaLink,
  instrumentClasses,
  instrumentReadoutPanel,
  monoLink,
  profileTabActive,
  profileTabInactive,
  serialLabel,
  shellControlHover,
  trustStampBase,
  trustStampKarPro,
  elevatedAdvisoryChip,
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  trustStampSuccess,
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

  it("instrumentReadoutPanel is Level B shell", () => {
    assert.match(instrumentReadoutPanel, /rounded-md/);
    assert.match(instrumentReadoutPanel, /border-border-default/);
    assert.match(instrumentReadoutPanel, /bg-bg-surface/);
    assert.match(instrumentReadoutPanel, /p-4/);
  });

  it("profileTabActive uses accent bottom border only", () => {
    assert.match(profileTabActive, /border-accent-warm/);
    assert.match(profileTabActive, /border-b-2/);
    assert.doesNotMatch(profileTabActive, /bg-/);
  });

  it("profileTabInactive is transparent border", () => {
    assert.match(profileTabInactive, /border-transparent/);
    assert.doesNotMatch(profileTabInactive, /bg-/);
  });

  it("commerceConfirmedPanel uses status-success border", () => {
    assert.match(commerceConfirmedPanel, /border-status-success/);
    assert.doesNotMatch(commerceConfirmedPanel, /accent-warm/);
  });

  it("commerceConfirmedLabel uses status-success mono eyebrow", () => {
    assert.match(commerceConfirmedLabel, /text-status-success/);
    assert.match(commerceConfirmedLabel, /tracking-\[0\.18em\]/);
    assert.doesNotMatch(commerceConfirmedLabel, /accent-warm/);
  });

  it("trustStampSuccess uses status-success only", () => {
    assert.match(trustStampSuccess, /border-status-success/);
    assert.match(trustStampSuccess, /text-status-success/);
    assert.doesNotMatch(trustStampSuccess, /accent-warm/);
  });

  it("elevatedAdvisory uses status-error chroma not accent", () => {
    assert.match(elevatedAdvisoryChip, /border-status-error\/40/);
    assert.match(elevatedAdvisoryChip, /bg-status-error\/10/);
    assert.match(elevatedAdvisoryPanel, /border-status-error\/40/);
    assert.match(elevatedAdvisoryText, /text-status-error/);
    assert.doesNotMatch(elevatedAdvisoryChip, /accent-warm/);
  });
});
