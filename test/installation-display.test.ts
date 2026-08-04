/**
 * Installation display pure helpers + devices chrome ownership policy.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  formatInstallationAge,
  shouldShowMessagingDevices,
  toInstallationDisplay,
} from "../lib/messaging/installation-display.ts";
import {
  ROOT,
  listTsFiles,
  stripComments,
} from "./messaging-invariant-helpers.ts";

const DEVICES_PANEL = path.join(
  ROOT,
  "components/messaging/messaging-devices-panel.tsx",
);
const SETTINGS = path.join(ROOT, "components/profile/messaging-settings-section.tsx");
const SETUP_ERROR = path.join(ROOT, "components/messaging/messaging-setup-error.tsx");
const SETUP_CARD = path.join(ROOT, "components/messaging/messaging-setup-card.tsx");

describe("shouldShowMessagingDevices", () => {
  // Blind spot: a future settings branch that calls readInstallations without
  // this gate would need a separate effect-body scan.

  it("is true only when a client handle is present", () => {
    assert.equal(shouldShowMessagingDevices({ client: null }), false);
    assert.equal(shouldShowMessagingDevices({ client: undefined }), false);
    assert.equal(shouldShowMessagingDevices({ client: {} }), true);
  });
});

describe("installation age and display mapping", () => {
  it("formats ages and maps readout rows", () => {
    const now = Date.parse("2026-08-04T12:00:00Z");
    assert.equal(formatInstallationAge(null, now), "age unknown");
    assert.equal(formatInstallationAge(now - 5 * 60_000, now), "5m old");
    assert.equal(formatInstallationAge(now - 3 * 3_600_000, now), "3h old");
    assert.equal(formatInstallationAge(now - 72 * 3_600_000, now), "3d old");

    const display = toInstallationDisplay(
      {
        installations: [
          { id: "abc123456789", createdAtMs: now - 60_000 },
          { id: "def987654321", createdAtMs: null },
        ],
        currentInstallationId: "abc123456789",
      },
      now,
    );
    assert.equal(display.count, 2);
    assert.equal(display.currentInstallationId, "abc123456789");
    assert.equal(display.rows[0]!.isCurrent, true);
    assert.equal(display.rows[0]!.ageLabel, "1m old");
    assert.equal(display.rows[1]!.isCurrent, false);
    assert.equal(display.rows[1]!.ageLabel, "age unknown");
  });
});

describe("devices chrome one owner", () => {
  // Blind spot: renamed Free/Revoke copy strings would evade the phrase scan.

  const chromePhrases = [
    "Free a device slot",
    "Revoke all devices",
    "devices registered on this account",
    "Revoke all message devices?",
  ] as const;

  function chromeHits(source: string): string[] {
    const text = stripComments(source);
    return chromePhrases.filter((phrase) => text.includes(phrase));
  }

  it("structural: installation chrome lives only in messaging-devices-panel", () => {
    assert.ok(fs.existsSync(DEVICES_PANEL));
    const ownerHits = chromeHits(fs.readFileSync(DEVICES_PANEL, "utf8"));
    assert.deepEqual([...ownerHits].sort(), [...chromePhrases].sort());

    const violations: string[] = [];
    for (const dir of [
      path.join(ROOT, "components"),
      path.join(ROOT, "lib/messaging"),
      path.join(ROOT, "hooks"),
    ]) {
      for (const file of listTsFiles(dir)) {
        if (file === DEVICES_PANEL) continue;
        // Snapshot label for primaryActionFromSnapshot — not chrome.
        if (file.endsWith("snapshot-ui.ts")) continue;
        if (file.endsWith("messaging-snapshot-ui.test.ts")) continue;
        const hits = chromeHits(fs.readFileSync(file, "utf8"));
        // Tests may quote phrases — allow under test/
        if (file.includes(`${path.sep}test${path.sep}`) || file.includes("/test/")) {
          continue;
        }
        for (const hit of hits) {
          violations.push(`${path.relative(ROOT, file)}: ${hit}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("structural: settings and setup-error compose the panel; setup-card has no age mapper", () => {
    const settings = stripComments(fs.readFileSync(SETTINGS, "utf8"));
    const setupError = stripComments(fs.readFileSync(SETUP_ERROR, "utf8"));
    const setupCard = stripComments(fs.readFileSync(SETUP_CARD, "utf8"));
    assert.ok(settings.includes("MessagingDevicesPanel"));
    assert.ok(settings.includes("shouldShowMessagingDevices"));
    assert.ok(setupError.includes("MessagingDevicesPanel"));
    assert.equal(setupCard.includes("formatInstallationAge"), false);
    assert.ok(setupCard.includes("toInstallationDisplay"));
  });

  it("catches a constructed forked Free-slot chrome", () => {
    const dirty = `
function DevicesFork() {
  return <button>Free a device slot</button>;
}
`;
    assert.deepEqual(chromeHits(dirty), ["Free a device slot"]);
    const clean = `import { MessagingDevicesPanel } from "./messaging-devices-panel";\n`;
    assert.deepEqual(chromeHits(clean), []);
  });
});

describe("settings never raises client demand or loads SDK", () => {
  it("structural: no demand / preload / loadXmtp in settings", () => {
    const settings = stripComments(fs.readFileSync(SETTINGS, "utf8"));
    assert.doesNotMatch(
      settings,
      /requestLocalClient|useRequestLocalMessagingClient|preloadXmtp|loadXmtp|Client\.build|Client\.create/,
    );
  });

  it("behavioural: gate blocks readout without client", () => {
    assert.equal(shouldShowMessagingDevices({ client: null }), false);
    // Settings effect uses showDevices = active && shouldShowMessagingDevices({ client })
    const showDevices =
      true && shouldShowMessagingDevices({ client: null }) && true;
    assert.equal(showDevices, false);
  });
});
