import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
  path.join(ROOT, "test"),
] as const;

/** Symbols that must not return after Variant A identity cleanup. */
const BANNED_V1_SYMBOLS = [
  "deriveAesKeyV1",
  "AES_V1_SALT",
  "aesLinkMessageV1",
  "encryptPrivateKeyV1",
  "decryptPrivateKeyV1",
  "encryptAppPayloadV1",
  "decryptAppPayloadV1",
  "migrateV1Blob",
  "loadDecryptedKey",
  "StoredEncryptedV1",
  "isV2Blob",
  "legacyLocalStorageKey",
  "migrateNostrIdentity",
  "identity-rotation",
  "IdentityRelinkCard",
  "canInitializeMessaging",
  "canInitializeNostr",
] as const;

const PREDICATE_OWNER = path.join(ROOT, "lib/web3/wallet-account.ts");
const MESSAGING_CONSUMER = path.join(ROOT, "lib/messaging/adapters/wallet-adapter.ts");
const NOSTR_KEY_MANAGER = path.join(ROOT, "lib/nostr/key-manager.ts");
const NOSTR_KEY_HOOK = path.join(ROOT, "hooks/use-nostr-key.tsx");

const PREDICATE_NAME = "supportsPersonalSignIdentity";

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importsPredicate(filePath: string): boolean {
  const text = fs.readFileSync(filePath, "utf8");
  return (
    text.includes(PREDICATE_NAME) &&
    /from\s*["']@\/lib\/web3\/wallet-account["']/.test(text)
  );
}

describe("personal-sign identity policy", () => {
  it("bans deleted V1 / rotation / forked-gate symbols across app surfaces", () => {
    const violations: string[] = [];
    const selfPolicy = path.join(ROOT, "test/personal-sign-identity-policy.test.ts");

    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === selfPolicy) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const symbol of BANNED_V1_SYMBOLS) {
          if (text.includes(symbol)) {
            violations.push(`${path.relative(ROOT, file)}: ${symbol}`);
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("defines supportsPersonalSignIdentity once in wallet-account", () => {
    const text = fs.readFileSync(PREDICATE_OWNER, "utf8");
    assert.ok(
      text.includes(`export function ${PREDICATE_NAME}`),
      "wallet-account must export supportsPersonalSignIdentity",
    );
    assert.equal(
      text.split(`function ${PREDICATE_NAME}`).length - 1,
      1,
      "predicate must be defined exactly once",
    );
  });

  it("messaging and Nostr both import the shared predicate", () => {
    assert.ok(
      importsPredicate(MESSAGING_CONSUMER),
      "wallet-adapter must import supportsPersonalSignIdentity",
    );
    assert.ok(
      importsPredicate(NOSTR_KEY_MANAGER),
      "key-manager must import supportsPersonalSignIdentity",
    );
    assert.ok(
      importsPredicate(NOSTR_KEY_HOOK),
      "use-nostr-key must import supportsPersonalSignIdentity",
    );
  });
});
