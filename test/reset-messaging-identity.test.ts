import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyXmtpCreateError,
  installationIdBytesFromInboxState,
  resolveInboxId,
  xmtpDatabaseFilename,
} from "../lib/xmtp/reset-messaging-identity.ts";

const ADDRESS = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;

const INSTALLATION_LIMIT_MESSAGE =
  "Cannot register a new installation because the InboxID abc123 has already registered 10; installations. Please revoke existing installations first.";

describe("classifyXmtpCreateError", () => {
  it("detects installation limit errors", () => {
    assert.equal(classifyXmtpCreateError(new Error(INSTALLATION_LIMIT_MESSAGE)), "installation_limit");
    assert.equal(classifyXmtpCreateError(INSTALLATION_LIMIT_MESSAGE), "installation_limit");
  });

  it("returns other for unrelated errors", () => {
    assert.equal(
      classifyXmtpCreateError(new Error("Failed to initialize OPFS")),
      "other",
    );
    assert.equal(classifyXmtpCreateError(new Error("Wallet not ready")), "other");
    assert.equal(classifyXmtpCreateError(null), "other");
  });
});

describe("installationIdBytesFromInboxState", () => {
  it("collects installation bytes in order", () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    const bytes = installationIdBytesFromInboxState({
      inboxId: "inbox-1",
      recoveryIdentifier: { identifier: "0xabc", identifierKind: 0 },
      accountIdentifiers: [],
      installations: [
        { id: "install-a", bytes: first },
        { id: "install-b", bytes: second },
      ],
    });

    assert.equal(bytes.length, 2);
    assert.deepEqual(bytes[0], first);
    assert.deepEqual(bytes[1], second);
  });

  it("returns empty array for missing state", () => {
    assert.deepEqual(installationIdBytesFromInboxState(undefined), []);
  });
});

describe("xmtpDatabaseFilename", () => {
  it("matches SDK default db path pattern", () => {
    assert.equal(
      xmtpDatabaseFilename("production", "inbox-abc"),
      "xmtp-production-inbox-abc.db3",
    );
  });
});

describe("resolveInboxId", () => {
  it("falls back to generateInboxId when network returns undefined", async () => {
    const generated = "generated-inbox-id";
    const resolved = await resolveInboxId(ADDRESS, {
      createBackend: async () => ({} as never),
      getInboxIdForIdentifier: async () => undefined,
      generateInboxId: async () => generated,
    });
    assert.equal(resolved, generated);
  });

  it("falls back to generateInboxId when network lookup throws", async () => {
    const generated = "fallback-after-error";
    const resolved = await resolveInboxId(ADDRESS, {
      createBackend: async () => {
        throw new Error("network unavailable");
      },
      generateInboxId: async () => generated,
    });
    assert.equal(resolved, generated);
  });

  it("returns network inbox id when present", async () => {
    const networkInboxId = "network-inbox-id";
    const resolved = await resolveInboxId(ADDRESS, {
      createBackend: async () => ({} as never),
      getInboxIdForIdentifier: async () => networkInboxId,
      generateInboxId: async () => "should-not-be-used",
    });
    assert.equal(resolved, networkInboxId);
  });
});
