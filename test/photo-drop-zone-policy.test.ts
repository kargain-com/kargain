import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EDIT_WIZARD = path.join(
  ROOT,
  "components/passport/edit-passport-wizard.tsx",
);
const UPLOAD_ZONE = path.join(
  ROOT,
  "components/passport/photo-upload-zone.tsx",
);
const DROP_ZONE = path.join(ROOT, "components/passport/photo-drop-zone.tsx");

const PHOTO_DROP_ZONE_IMPORT =
  /from\s+["']@\/components\/passport\/photo-drop-zone["']/;

/**
 * Original failure: empty Photos section put an inline `<Label>Photos</Label>`
 * next to an inline-flex secondary `<Button>Add photos</Button>`, so they
 * rendered on one cramped line. Both create and edit must share PhotoDropZone.
 */
describe("photo drop zone policy", () => {
  it("forbids the edit Label + Add photos Button anti-pattern", () => {
    const text = fs.readFileSync(EDIT_WIZARD, "utf8");

    assert.match(
      text,
      PHOTO_DROP_ZONE_IMPORT,
      "edit-passport-wizard must import PhotoDropZone",
    );

    assert.doesNotMatch(
      text,
      /<Label>\s*Photos\s*<\/Label>/,
      "edit Photos must not use an inline Label (collapses beside the CTA)",
    );

    assert.doesNotMatch(
      text,
      />\s*Add photos\s*</,
      "edit must not use an Add photos Button CTA (use PhotoDropZone)",
    );

    assert.doesNotMatch(
      text,
      /variant=["']secondary["'][^>]*>[\s\S]*?Add photos/,
      "edit must not pair a secondary Button with Add photos",
    );
  });

  it("requires create and edit to share PhotoDropZone", () => {
    assert.ok(
      fs.existsSync(DROP_ZONE),
      "components/passport/photo-drop-zone.tsx must exist",
    );

    const editText = fs.readFileSync(EDIT_WIZARD, "utf8");
    const uploadText = fs.readFileSync(UPLOAD_ZONE, "utf8");

    assert.match(editText, PHOTO_DROP_ZONE_IMPORT);
    assert.match(uploadText, PHOTO_DROP_ZONE_IMPORT);
    assert.match(uploadText, /\bPhotoDropZone\b/);
    assert.match(editText, /\bPhotoDropZone\b/);
  });
});
