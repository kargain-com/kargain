import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatMetadataDiffForDisplay,
  summarizePhotoChanges,
} from "../lib/passport/format-metadata-diff-display.ts";
import { diffPassportMetadata } from "../lib/passport/metadata-diff.ts";
import type { PassportMetadata } from "../lib/passport/metadata-schema.ts";

const baseMetadata: PassportMetadata = {
  version: "1.1",
  vin: "1HGBH41JXMN109186",
  make: "Honda",
  model: "Civic",
  year: 2021,
  mileageKm: 10000,
  photos: ["ar://existing-a", "ar://existing-b"],
  description: "Original description",
};

describe("formatMetadataDiffForDisplay", () => {
  it("maps scalar fields to human labels and formatted mileage", () => {
    const after: PassportMetadata = {
      ...baseMetadata,
      mileageKm: 10600,
    };
    const diff = diffPassportMetadata(baseMetadata, after);
    const display = formatMetadataDiffForDisplay(diff);

    const mileage = display.identityChanges.find((c) => c.field === "mileageKm");
    assert.ok(mileage && mileage.kind === "scalar");
    assert.equal(mileage.label, "Mileage");
    assert.equal(mileage.before, "10,000 km");
    assert.equal(mileage.after, "10,600 km");
  });

  it("splits identity vs other changes from anchor/cosmetic diff", () => {
    const after: PassportMetadata = {
      ...baseMetadata,
      vin: "5YJ3E1EA1KF123456",
      description: "Updated description",
    };
    const diff = diffPassportMetadata(baseMetadata, after);
    const display = formatMetadataDiffForDisplay(diff);

    assert.ok(display.identityChanges.some((c) => c.field === "vin"));
    assert.ok(display.otherChanges.some((c) => c.field === "description"));
    assert.equal(display.hasIdentityChanges, true);
  });

  it("formats photo changes without raw new: placeholders in summary", () => {
    const after: PassportMetadata = {
      ...baseMetadata,
      photos: [
        "ar://existing-a",
        "ar://existing-b",
        "new:4pW0QfNvqP3oFYiKdKdH7",
        "new:tSXo6-8Chgn1bg8N4xf2D",
      ],
    };
    const diff = diffPassportMetadata(baseMetadata, after);
    const display = formatMetadataDiffForDisplay(diff, {
      photoContext: {
        resolveThumb: (_uri, index) => ({
          src: `blob:preview-${index}`,
          alt: `Photo ${index + 1}`,
        }),
      },
    });

    const photos = display.identityChanges.find((c) => c.field === "photos");
    assert.ok(photos && photos.kind === "photos");
    assert.equal(photos.summary.addedCount, 2);
    assert.equal(photos.summary.summaryLine, "2 photos added");
    assert.equal(photos.summary.addedThumbs.length, 2);
    assert.equal(photos.summary.summaryLine.includes("new:"), false);
    assert.equal(photos.summary.summaryLine.includes("ar://"), false);
  });

  it("truncates long description values", () => {
    const longText = "A".repeat(100);
    const after: PassportMetadata = {
      ...baseMetadata,
      description: longText,
    };
    const diff = diffPassportMetadata(baseMetadata, after);
    const display = formatMetadataDiffForDisplay(diff);

    const description = display.otherChanges.find((c) => c.field === "description");
    assert.ok(description && description.kind === "scalar");
    assert.equal(description.after.endsWith("…"), true);
    assert.equal(description.after.length < longText.length, true);
  });
});

describe("summarizePhotoChanges", () => {
  it("detects cover photo change", () => {
    const summary = summarizePhotoChanges(
      ["ar://a", "ar://b"],
      ["ar://c", "ar://b"],
    );
    assert.equal(summary.coverChanged, true);
    assert.equal(summary.addedCount, 1);
    assert.equal(summary.removedCount, 1);
    assert.ok(summary.summaryLine.includes("Cover photo changed"));
  });
});
