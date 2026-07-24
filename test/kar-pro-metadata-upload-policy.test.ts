import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PURE_METADATA = path.join(ROOT, "lib/kar-pro/kar-pro-metadata.ts");
const UPLOAD_MODULE = path.join(ROOT, "lib/kar-pro/upload-kar-pro-metadata.ts");
const JOIN_FORM = path.join(ROOT, "components/kar-pro/kar-pro-join-form.tsx");
const PROFILE_SECTION = path.join(
  ROOT,
  "components/kar-pro/kar-pro-profile-section.tsx",
);

const IRYS_IMPORT =
  /from\s+["']@\/lib\/storage\/irys-client["']|from\s+["']@irys\//;
const UPLOAD_FN_IMPORT =
  /uploadKarProMetadata[\s\S]*?from\s+["']@\/lib\/kar-pro\/upload-kar-pro-metadata["']|from\s+["']@\/lib\/kar-pro\/upload-kar-pro-metadata["'][\s\S]*?uploadKarProMetadata/;

/**
 * Pure KarPro metadata must not pull the Irys SDK. Upload lives in
 * upload-kar-pro-metadata.ts (passport pattern: upload-passport-metadata.ts).
 */
describe("kar-pro metadata upload policy", () => {
  it("forbids irys / irys-client imports in pure kar-pro-metadata", () => {
    const text = fs.readFileSync(PURE_METADATA, "utf8");
    assert.doesNotMatch(
      text,
      IRYS_IMPORT,
      "kar-pro-metadata.ts must not import @irys/* or irys-client",
    );
    assert.doesNotMatch(
      text,
      /\buploadJson\b|\bwithRetry\b|\buploadKarProMetadata\b/,
      "kar-pro-metadata.ts must not define or call upload helpers",
    );
  });

  it("requires join and profile to import upload from the upload module", () => {
    assert.ok(fs.existsSync(UPLOAD_MODULE), "upload-kar-pro-metadata.ts must exist");

    const joinText = fs.readFileSync(JOIN_FORM, "utf8");
    const profileText = fs.readFileSync(PROFILE_SECTION, "utf8");

    assert.match(joinText, UPLOAD_FN_IMPORT);
    assert.match(profileText, UPLOAD_FN_IMPORT);

    assert.doesNotMatch(
      joinText,
      /uploadKarProMetadata[\s\S]*?from\s+["']@\/lib\/kar-pro\/kar-pro-metadata["']/,
      "join form must not import uploadKarProMetadata from pure metadata",
    );
    assert.doesNotMatch(
      profileText,
      /uploadKarProMetadata[\s\S]*?from\s+["']@\/lib\/kar-pro\/kar-pro-metadata["']/,
      "profile section must not import uploadKarProMetadata from pure metadata",
    );
  });
});
