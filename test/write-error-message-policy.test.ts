/**
 * Unit E — write chrome must not render or classify via Error.message.
 * Allowlist = messaging / XMTP / Nostr (+ one classifier-only provider hook).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

/**
 * Files allowed to read Error.message — other owner (messaging) or classifier-only
 * with no chrome render. Each entry carries the Unit E reason.
 */
export const WRITE_ERROR_MESSAGE_ALLOWLIST: Readonly<
  Record<string, string>
> = {
  "components/messaging/conversation-thread-client.tsx":
    "other owner — queued (XMTP send)",
  "components/messaging/message-inbox-client.tsx":
    "other owner — queued (ContactPeer / XMTP)",
  "components/marketplace/seller-contact-button.tsx":
    "other owner — queued (ContactPeer messaging)",
  "hooks/use-nostr-key.tsx": "other owner — queued (Nostr key unlock)",
  "components/providers/app-providers.tsx":
    "classifier-only — WalletConnect unauthorized rejection silence; no chrome render",
};

/**
 * Error-shaped `.message` reads that classify or render failure text.
 * Intentionally narrow — Result fields like `outcome.message` are out of scope.
 */
const ERROR_MESSAGE_READ =
  /\b(?:err|error|e|connectError|reason)\b(?:\s+as\s+Error)?\s*\.\s*message\b|\(error\s+as\s+Error\)\s*\.\s*message\b|\(err\s+as\s+Error\)\s*\.\s*message\b|\(reason\s+as\s+Error\)\s*\.\s*message\b/;

function errorMessageViolation(relPath: string, source: string): string | false {
  if (WRITE_ERROR_MESSAGE_ALLOWLIST[relPath] != null) return false;
  // Owner under scan: ban resolveRevertCopy / decodeSvm / raw message arms forever.
  if (relPath === "lib/marketplace/tx-error-message.ts") {
    if (/\bresolveRevertCopy\b/.test(source)) {
      return "tx-error-message must not export resolveRevertCopy";
    }
    if (/\bdecodeSvmProgramError\b/.test(source)) {
      return "tx-error-message must not export decodeSvmProgramError";
    }
    if (/\bextractSvmProgramErrorOrdinal\b/.test(source)) {
      return "tx-error-message must not export extractSvmProgramErrorOrdinal";
    }
    if (ERROR_MESSAGE_READ.test(source)) {
      return "tx-error-message must not read Error.message";
    }
    return false;
  }
  // Only components + hooks for chrome/call sites (plus owner above).
  if (!relPath.startsWith("components/") && !relPath.startsWith("hooks/")) {
    return false;
  }
  if (ERROR_MESSAGE_READ.test(source)) {
    return `Error.message read in write/chrome path (${relPath})`;
  }
  return false;
}

describe("write-error-message-policy (Unit E)", () => {
  it("components/hooks + tx-error-message have no Error.message chrome outside allowlist", () => {
    assertCleanProductScan(scanProductSources(errorMessageViolation));
  });

  it("planted Error.message read under components turns red", () => {
    const planted = `export function Plant() {\n  return (err as Error).message;\n}\n`;
    const hit = errorMessageViolation(
      "components/marketplace/__plant_unit_e__.tsx",
      planted,
    );
    assert.equal(
      typeof hit,
      "string",
      "planted .message read must turn red",
    );
  });

  it("allowlisted messaging file stays green with .message", () => {
    const hit = errorMessageViolation(
      "components/messaging/conversation-thread-client.tsx",
      'setSendError(e instanceof Error ? e.message : "x");\n',
    );
    assert.equal(hit, false);
  });

  it("every allowlist reason is non-empty", () => {
    for (const [path, reason] of Object.entries(WRITE_ERROR_MESSAGE_ALLOWLIST)) {
      assert.ok(reason.trim().length > 0, path);
      assert.match(reason, /other owner|classifier-only/);
    }
  });
});
