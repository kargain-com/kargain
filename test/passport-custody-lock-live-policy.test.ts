/**
 * Unit O corrective — sole live custody-lock door + mode-custody honesty.
 *
 * Product `functionName: "custodyLocked"` only in passport-commerce-facts.
 * Live reader: SVM PassportState → known true/false (never eternal pending);
 * state-PDA failure → `pda_failed` (not malformed_response).
 * Mode-custody takes PassportHolder; unread → unknown; PDA fail → typed refused.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  custodyLockFromKeyedEntry,
  readPassportCustodyLockLive,
} from "@/lib/passport/passport-commerce-facts";
import {
  passportHeldByModeCustody,
  type PassportHolder,
} from "@/lib/passport/passport-holder";
import {
  hexToBytes,
  passportStateLayout,
} from "@/lib/svm/decode-account-state";
import type { CommercialRegistry } from "@/lib/web3/commercial-active";
import { mintProtocolOwner } from "@/lib/web3/protocol-address";
import { svmAccountData } from "@/lib/web3/svm-rpc";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/passport-commerce-facts.ts";
const HOLDER_REL = "lib/passport/passport-holder.ts";
const EDIT_REL = "app/(identity)/passport/[tokenId]/edit/page.tsx";

const CUSTODY_LOCKED_ALLOWLIST: Readonly<Record<string, string>> = {
  [OWNER_REL]:
    "Sole dual-VM custodyLocked plan + readPassportCustodyLockLive",
};

const CUSTODY_LOCKED_RE =
  /functionName\s*:\s*["']custodyLocked["']/;

const PRODUCT_ROOTS = ["app", "components", "hooks", "lib"] as const;

/** custody_locked bool sits after disc(8)+token(32)+status(1)+verifier(32)+verified_at(8) = 81 */
const CUSTODY_LOCKED_OFFSET = 81;

const MODE_CUSTODY_PDA = FIXTURE_SVM_STACK.karPassport;
const STRANGER_OWNER = FIXTURE_SVM_STACK.karProPass;

function walkTs(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
  }
}

function findCustodyLockedViolations(): string[] {
  const hits: string[] = [];
  for (const root of PRODUCT_ROOTS) {
    const files: string[] = [];
    walkTs(path.join(ROOT, root), files);
    for (const abs of files) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      if (CUSTODY_LOCKED_ALLOWLIST[rel] != null) continue;
      const src = readFileSync(abs, "utf8");
      if (CUSTODY_LOCKED_RE.test(src)) hits.push(rel);
    }
  }
  return hits;
}

function fixtureRegistry(): CommercialRegistry {
  return {
    [FIXTURE_SVM_NAMESPACE]: FIXTURE_SVM_STACK,
  } as CommercialRegistry;
}

function passportStateBytes(locked: boolean): Uint8Array {
  const golden = hexToBytes(passportStateLayout().goldenHex);
  const bytes = new Uint8Array(golden);
  bytes[CUSTODY_LOCKED_OFFSET] = locked ? 1 : 0;
  return bytes;
}

function plantedDeriveOk(address = "StatePda1111111111111111111111111111111") {
  return async () =>
    ({
      ok: true as const,
      address,
      bump: 255,
      recipe: { id: "kar-passport/state" },
    }) as Awaited<ReturnType<typeof import("@/lib/svm/derive-pda").deriveSvmPda>>;
}

function knownHolder(ownerAddress: string): PassportHolder {
  const owner = mintProtocolOwner(FIXTURE_SVM_NAMESPACE, ownerAddress);
  assert.ok(owner != null);
  return { status: "known", owner, source: "chain" };
}

describe("passport-custody-lock-live-policy", () => {
  it("product custodyLocked only in passport-commerce-facts", () => {
    const hits = findCustodyLockedViolations();
    assert.equal(
      hits.length,
      0,
      `unexpected custodyLocked sites: ${hits.join(", ")}`,
    );
  });

  it("planted edit-page custodyLocked is red then green", () => {
    const dirty = `const x = { functionName: "custodyLocked" as const };`;
    assert.match(dirty, CUSTODY_LOCKED_RE);
    const clean = dirty.replace(CUSTODY_LOCKED_RE, 'functionName: "ownerOf"');
    assert.doesNotMatch(clean, CUSTODY_LOCKED_RE);
  });

  it("edit page has no getPublicClient / KarPassportAbi / passportAddr fork", () => {
    const src = readFileSync(path.join(ROOT, EDIT_REL), "utf8");
    assert.doesNotMatch(src, /getPublicClient/);
    assert.doesNotMatch(src, /KarPassportAbi/);
    assert.doesNotMatch(src, /passportAddr/);
    assert.doesNotMatch(src, /functionName\s*:\s*["']custodyLocked["']/);
    assert.match(src, /readPassportCustodyLockLive/);
    assert.match(src, /modeCustodyRefused/);
    assert.doesNotMatch(src, /derivePassportPresence/);
    assert.doesNotMatch(src, /passportHolderOwnerAddress/);
    assert.match(src, /modeHold\.status === ["']refused["']/);
    assert.match(src, /modeHold\.status === ["']unknown["']/);
  });

  it("scan stays clean for custodyLocked allowlist", () => {
    const owners = Object.keys(CUSTODY_LOCKED_ALLOWLIST);
    assertCleanProductScan(
      scanProductSources(
        (_rel, src) =>
          CUSTODY_LOCKED_RE.test(src)
            ? "custodyLocked outside commerce-facts"
            : false,
        { owners },
      ),
      { owners },
    );
  });

  it("SVM PassportState locked=false → live known false (not pending)", async () => {
    const data = passportStateBytes(false);
    const lock = await readPassportCustodyLockLive({
      namespace: FIXTURE_SVM_NAMESPACE,
      tokenId: "1",
      registry: fixtureRegistry(),
      derivePda: plantedDeriveOk(),
      fetchAccountData: async () => ({
        ok: true,
        value: svmAccountData(data, FIXTURE_SVM_STACK.karPassport),
      }),
    });
    assert.deepEqual(lock, { status: "known", locked: false });
  });

  it("SVM PassportState locked=true → live known true", async () => {
    const data = passportStateBytes(true);
    const lock = await readPassportCustodyLockLive({
      namespace: FIXTURE_SVM_NAMESPACE,
      tokenId: "1",
      registry: fixtureRegistry(),
      derivePda: plantedDeriveOk(),
      fetchAccountData: async () => ({
        ok: true,
        value: svmAccountData(data, FIXTURE_SVM_STACK.karPassport),
      }),
    });
    assert.deepEqual(lock, { status: "known", locked: true });
  });

  it("SVM account_not_found → refused (never pending)", async () => {
    const lock = await readPassportCustodyLockLive({
      namespace: FIXTURE_SVM_NAMESPACE,
      tokenId: "1",
      registry: fixtureRegistry(),
      derivePda: plantedDeriveOk(),
      fetchAccountData: async () => ({
        ok: false,
        cause: "account_not_found",
        detail: "missing",
      }),
    });
    assert.deepEqual(lock, {
      status: "refused",
      cause: "account_not_found",
    });
  });

  it("state-PDA derive failure → pda_failed (not malformed_response)", async () => {
    const lock = await readPassportCustodyLockLive({
      namespace: FIXTURE_SVM_NAMESPACE,
      tokenId: "1",
      registry: fixtureRegistry(),
      derivePda: async () => ({
        ok: false,
        cause: "unregistered_program",
        detail: "plant",
      }),
    });
    assert.deepEqual(lock, { status: "refused", cause: "pda_failed" });
    assert.notEqual(
      (lock as { cause?: string }).cause,
      "malformed_response",
    );
  });

  it("EVM live inject → known boolean via mapper", async () => {
    const lock = await readPassportCustodyLockLive({
      namespace: 84532,
      tokenId: "7",
      readEvmCustodyLocked: async () => true,
    });
    assert.deepEqual(lock, { status: "known", locked: true });
    const unlocked = await readPassportCustodyLockLive({
      namespace: 84532,
      tokenId: "7",
      readEvmCustodyLocked: async () => false,
    });
    assert.deepEqual(unlocked, { status: "known", locked: false });
  });

  it("mapper still refuses malformed SVM payload", () => {
    const lock = custodyLockFromKeyedEntry({
      status: "success",
      result: { data: new Uint8Array([1, 2, 3]), owner: "x" },
    });
    assert.equal(lock.status, "refused");
  });

  for (const status of [
    "pending",
    "in_transit",
    "absent",
    "refused",
  ] as const) {
    it(`holder ${status} → mode custody unknown (not not_held)`, async () => {
      const holder: PassportHolder =
        status === "refused"
          ? { status: "refused", cause: "core_decode_failed" }
          : { status };
      const hold = await passportHeldByModeCustody({
        namespace: FIXTURE_SVM_NAMESPACE,
        holder,
        registry: fixtureRegistry(),
      });
      assert.deepEqual(hold, { status: "unknown", holder: status });
      assert.notEqual(hold.status, "not_held" as const);
    });
  }

  it("known held by mode PDA → held", async () => {
    const hold = await passportHeldByModeCustody({
      namespace: FIXTURE_SVM_NAMESPACE,
      holder: knownHolder(MODE_CUSTODY_PDA),
      registry: fixtureRegistry(),
      derivePda: plantedDeriveOk(MODE_CUSTODY_PDA),
    });
    assert.equal(hold.status, "held");
  });

  it("known not a mode → not_held", async () => {
    const hold = await passportHeldByModeCustody({
      namespace: FIXTURE_SVM_NAMESPACE,
      holder: knownHolder(STRANGER_OWNER),
      registry: fixtureRegistry(),
      derivePda: plantedDeriveOk(MODE_CUSTODY_PDA),
    });
    assert.equal(hold.status, "not_held");
  });

  it("planted PDA derive failure → typed refused with pdaCause", async () => {
    const hold = await passportHeldByModeCustody({
      namespace: FIXTURE_SVM_NAMESPACE,
      holder: knownHolder(STRANGER_OWNER),
      registry: fixtureRegistry(),
      derivePda: async () => ({
        ok: false,
        cause: "unregistered_program",
        detail: "plant",
      }),
    });
    assert.equal(hold.status, "refused");
    if (hold.status !== "refused") return;
    assert.equal(hold.cause, "pda_failed");
    if (hold.cause !== "pda_failed") return;
    assert.equal(hold.pdaCause, "unregistered_program");
    assert.ok(typeof hold.mode === "string" && hold.mode.length > 0);
  });

  it("mode-custody owner has no text-encoded pda_failed cause", () => {
    const owner = readFileSync(path.join(ROOT, HOLDER_REL), "utf8");
    assert.doesNotMatch(
      owner,
      /pda_failed:\$\{/,
      "cause must not be a template string",
    );
    assert.doesNotMatch(owner, /holderOwner/);
    assert.match(owner, /status:\s*["']unknown["']/);
    assert.match(owner, /cause:\s*["']pda_failed["']/);
    assert.match(owner, /pdaCause:/);
  });

  it("HEAD skip→false defect class: silent continue would be not_held", () => {
    const headDefect = `if (!pda.ok) continue;\nreturn false;`;
    assert.match(headDefect, /continue/);
    const owner = readFileSync(path.join(ROOT, HOLDER_REL), "utf8");
    assert.doesNotMatch(
      owner,
      /if\s*\(\s*!pda\.ok\s*\)\s*continue/,
      "silent PDA skip must stay deleted",
    );
    assert.match(owner, /status:\s*["']refused["']/);
  });
});
