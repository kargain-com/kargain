import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * P7: messaging surfaces must dispatch commands from the session contract
 * (primaryActionFromSnapshot) or the explicit secondary allowlist — not invent
 * next independently of snapshot.next.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SURFACE_FILES = [
  "components/messaging/messaging-setup-card.tsx",
  "components/messaging/messaging-setup-error.tsx",
  "components/marketplace/seller-messaging-banner.tsx",
  "components/profile/messaging-settings-section.tsx",
] as const;

const HELPER = path.join(ROOT, "lib/messaging/snapshot-ui.ts");

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("messaging CTA contract policy (P7)", () => {
  it("primaryActionFromSnapshot owns next→command mapping", () => {
    const text = fs.readFileSync(HELPER, "utf8");
    assert.ok(text.includes("export function primaryActionFromSnapshot"));
    assert.ok(text.includes("SECONDARY_REVOKE_ALL_COMMAND"));
  });

  it("setup card consumes primaryActionFromSnapshot and does not invent retry on opfs", () => {
    const card = stripComments(
      fs.readFileSync(path.join(ROOT, "components/messaging/messaging-setup-card.tsx"), "utf8"),
    );
    assert.ok(card.includes("primaryActionFromSnapshot"));
    assert.ok(card.includes('reason === "opfs_lock"'));
    // Must not hardcode dispatch retry in the opfs branch.
    assert.equal(
      /opfs_lock[\s\S]{0,800}dispatch\(\{\s*type:\s*"retry"/.test(card),
      false,
    );
    assert.equal(card.includes("enableWalletSignaturesCopy(3)"), false);
    assert.equal(card.includes("still registered"), false);
  });

  it("surfaces import the contract helper (or only secondary callbacks)", () => {
    for (const rel of SURFACE_FILES) {
      const text = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      if (rel.endsWith("messaging-setup-error.tsx")) {
        // Receives callbacks from the card — no direct dispatch.
        assert.equal(/\bdispatch\s*\(/.test(text), false);
        continue;
      }
      assert.ok(
        text.includes("primaryActionFromSnapshot") ||
          text.includes("SECONDARY_REVOKE_ALL_COMMAND"),
        `${rel} must consume the contract helper`,
      );
    }
  });

  it("settings switch may enable/disable; publish retry uses helper", () => {
    const text = stripComments(
      fs.readFileSync(
        path.join(ROOT, "components/profile/messaging-settings-section.tsx"),
        "utf8",
      ),
    );
    assert.ok(text.includes("primaryActionFromSnapshot"));
    assert.ok(text.includes('type: "enable"') || text.includes('dispatch({ type: "enable" })'));
    assert.ok(text.includes('type: "disable"') || text.includes('dispatch({ type: "disable" })'));
  });
});
