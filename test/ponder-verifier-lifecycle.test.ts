import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifier } from "../ponder.schema.ts";
import {
  normalizeVerifierId,
  patchVerifierIfExists,
  proPassBurnedPatch,
  proPassMintedRow,
  proPassProfilePatch,
  type VerifierIndexerDb,
  type VerifierRow,
  upsertVerifierFromProPassMint,
  upsertVerifierFromStakingJoin,
  verificationFeePatch,
  verifierJoinedRow,
  verifierLeftPatch,
} from "../src/lib/ponder-verifier-lifecycle.ts";

const HOLDER = "0xCf1eb0E7ed453Ed266bF90E7C09e0E4769580b77";
const VERIFIER_ADDR = "0xAbC0000000000000000000000000000000000001";

function createMockVerifierDb(): VerifierIndexerDb & { rows: Map<string, VerifierRow> } {
  const rows = new Map<string, VerifierRow>();

  return {
    rows,
    find: async (_table, { id }) => rows.get(id) ?? null,
    insert: (_table) => ({
      values: (row) => ({
        onConflictDoUpdate: async (patch) => {
          const existing = rows.get(row.id);
          if (existing) {
            rows.set(row.id, { ...existing, ...patch });
          } else {
            rows.set(row.id, row);
          }
        },
      }),
    }),
    update: (_table, { id }) => ({
      set: async (patch) => {
        const existing = rows.get(id);
        if (!existing) throw new Error("RecordNotFoundError");
        rows.set(id, { ...existing, ...patch });
      },
    }),
  };
}

describe("ponder verifier lifecycle builders", () => {
  it("normalizes verifier id to lowercase", () => {
    assert.equal(normalizeVerifierId(HOLDER), HOLDER.toLowerCase());
  });

  it("builds staking join row", () => {
    const row = verifierJoinedRow(VERIFIER_ADDR, 0, 50_000_000_000_000_000n, 100n);
    assert.equal(row.id, VERIFIER_ADDR.toLowerCase());
    assert.equal(row.address, VERIFIER_ADDR);
    assert.equal(row.stakeAsset, 0);
    assert.equal(row.stakeAmount, "50000000000000000");
    assert.equal(row.active, true);
    assert.equal(row.joinedAt, 100n);
  });

  it("builds pro pass mint row", () => {
    const row = proPassMintedRow(HOLDER, 2, "Acme Verify", "ar://meta", "acme");
    assert.equal(row.category, 2);
    assert.equal(row.name, "Acme Verify");
    assert.equal(row.slug, "acme");
    assert.equal(row.active, true);
  });

  it("builds left, fee, profile, and burn patches", () => {
    assert.deepEqual(verifierLeftPatch(200n), {
      active: false,
      stakeAmount: "0",
      leftAt: 200n,
    });
    assert.deepEqual(verificationFeePatch(1_000n), { verificationFee: 1_000n });
    assert.deepEqual(proPassProfilePatch(3, "New Name", "ar://new", "new-slug"), {
      category: 3,
      name: "New Name",
      metadataURI: "ar://new",
      slug: "new-slug",
    });
    assert.deepEqual(proPassBurnedPatch(), { active: false });
  });
});

describe("patchVerifierIfExists", () => {
  it("no-ops on empty db without creating a row", async () => {
    const db = createMockVerifierDb();
    const id = normalizeVerifierId(HOLDER);

    const patched = await patchVerifierIfExists(db, id, proPassBurnedPatch());

    assert.equal(patched, false);
    assert.equal(db.rows.size, 0);
  });

  it("no-ops profile and fee updates when row is missing", async () => {
    const db = createMockVerifierDb();
    const id = normalizeVerifierId(HOLDER);

    assert.equal(
      await patchVerifierIfExists(
        db,
        id,
        proPassProfilePatch(1, "X", "ar://x", "x"),
      ),
      false,
    );
    assert.equal(
      await patchVerifierIfExists(db, id, verificationFeePatch(99n)),
      false,
    );
    assert.equal(db.rows.size, 0);
  });

  it("deactivates after pro pass mint", async () => {
    const db = createMockVerifierDb();
    const id = normalizeVerifierId(HOLDER);

    await upsertVerifierFromProPassMint(db, HOLDER, 1, "Shop", "ar://shop", "shop");
    assert.equal(db.rows.get(id)?.active, true);

    const patched = await patchVerifierIfExists(db, id, proPassBurnedPatch());

    assert.equal(patched, true);
    assert.equal(db.rows.get(id)?.active, false);
  });

  it("deactivates after staking join", async () => {
    const db = createMockVerifierDb();
    const id = normalizeVerifierId(VERIFIER_ADDR);

    await upsertVerifierFromStakingJoin(db, VERIFIER_ADDR, 0, 50_000_000_000_000_000n, 100n);
    assert.equal(db.rows.get(id)?.active, true);

    const patched = await patchVerifierIfExists(db, id, verifierLeftPatch(300n));

    assert.equal(patched, true);
    const row = db.rows.get(id);
    assert.equal(row?.active, false);
    assert.equal(row?.stakeAmount, "0");
    assert.equal(row?.leftAt, 300n);
  });

  it("updates profile when row exists", async () => {
    const db = createMockVerifierDb();
    const id = normalizeVerifierId(HOLDER);

    await upsertVerifierFromProPassMint(db, HOLDER, 1, "Old", "ar://old", "old");
    await patchVerifierIfExists(
      db,
      id,
      proPassProfilePatch(2, "New", "ar://new", "new"),
    );

    const row = db.rows.get(id);
    assert.equal(row?.category, 2);
    assert.equal(row?.name, "New");
    assert.equal(row?.slug, "new");
  });
});

describe("upsertVerifierFromProPassMint", () => {
  it("uses verifier table symbol for find compatibility", async () => {
    const db = createMockVerifierDb();
    await upsertVerifierFromProPassMint(db, HOLDER, 1, "A", "ar://a", "a");
    const found = await db.find(verifier, { id: normalizeVerifierId(HOLDER) });
    assert.ok(found);
    assert.equal(found.name, "A");
  });
});
