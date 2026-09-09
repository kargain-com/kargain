/**
 * svm-ingest `/ready` declared↔served facts + bootstrap_range_not_enumerated on surface.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DiscoverIngestSlotsOk } from "../lib/svm/ingest-slot-discovery.js";
import {
  assertSvmIngestReadyServedFacts,
  buildSvmIngestReadyPayload,
  classifySvmIngestReadySurface,
  createSvmIngestHealthServer,
} from "../src/svm-ingest/http-health.js";
import { createIngestLoop } from "../src/svm-ingest/ingest-loop.js";
import {
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
  FIXTURE_PASSPORT_PROGRAM,
} from "./fixtures/svm-ingest/fixture-block.js";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.js";

async function fetchReady(port: number): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await fetch(`http://127.0.0.1:${port}/ready`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

function makeRpc(args: {
  head: number;
  firstAvailable: number;
  signaturesByProgram?: Record<string, string[]>;
}) {
  return {
    getSlot: async () => args.head,
    getFirstAvailableBlock: async () => args.firstAvailable,
    getSignaturesForAddress: async () =>
      (args.signaturesByProgram?.[FIXTURE_PASSPORT_PROGRAM] ?? []).map((s) => ({
        signature: s,
        slot: args.head,
      })),
    getBlock: async () => null,
  };
}

describe("svm-ingest readiness surface", () => {
  it("declared fact missing from served payload turns red", () => {
    assert.throws(
      () =>
        assertSvmIngestReadyServedFacts({
          status: "ready",
          bootstrapState: null,
          incident: null,
          lagSlots: 0,
        }),
      /svm_ingest_ready_declared_fact_missing: lastContiguousSlot/,
    );
  });

  it("undeclared fact served turns red", () => {
    assert.throws(
      () =>
        assertSvmIngestReadyServedFacts({
          status: "ready",
          bootstrapState: null,
          incident: null,
          lagSlots: 0,
          lastContiguousSlot: 1,
          extraFact: true,
        }),
      /svm_ingest_ready_undeclared_fact_served: extraFact/,
    );
  });

  it("classifies bootstrap incomplete vs caught up vs incident", () => {
    assert.equal(
      classifySvmIngestReadySurface(
        buildSvmIngestReadyPayload({
          ready: true,
          bootstrapState: null,
          incident: null,
          lagSlots: 0,
          lastContiguousSlot: 10,
        }),
      ),
      "caught_up",
    );
    assert.equal(
      classifySvmIngestReadySurface(
        buildSvmIngestReadyPayload({
          ready: false,
          bootstrapState: "historical_backfill",
          incident: "bootstrap_range_not_enumerated",
          lagSlots: 0,
          lastContiguousSlot: 5,
        }),
      ),
      "bootstrap_incomplete",
    );
    assert.equal(
      classifySvmIngestReadySurface(
        buildSvmIngestReadyPayload({
          ready: false,
          bootstrapState: null,
          incident: "catchup_window_exceeded",
          lagSlots: 99,
          lastContiguousSlot: 5,
        }),
      ),
      "incident",
    );
  });

  it("bootstrap_range_not_enumerated is driven by the loop and read off /ready HTTP", async () => {
    const startSlot = 100;
    const head = 500;
    const programs = [
      {
        ...FIXTURE_FOLLOWED_PROGRAMS[0]!,
        deploySlot: startSlot,
      },
    ];
    const planted: DiscoverIngestSlotsOk = {
      ok: true,
      slots: [],
      signaturePages: 1,
      signatureRows: 0,
      reachedEveryProgramFloor: false,
      programFloors: [
        {
          evidenceKey: programs[0]!.evidenceKey,
          programId: programs[0]!.programId,
          reachedFloor: false,
        },
      ],
    };
    const rpc = makeRpc({
      head,
      firstAvailable: startSlot,
      signaturesByProgram: { [FIXTURE_PASSPORT_PROGRAM]: [] },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 10,
      followedPrograms: programs,
      writer,
      rpc: rpc as never,
      discoverSlots: async () => planted,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().catchupIncident, "bootstrap_range_not_enumerated");

    const health = createSvmIngestHealthServer({
      port: 0,
      getSnapshot: () => {
        const s = loop.getState();
        return {
          ready: loop.isReady(),
          bootstrapState: s.bootstrapState,
          incident: s.catchupIncident,
          lagSlots: s.lagSlots,
          lastContiguousSlot: s.lastContiguousSlot,
        };
      },
    });
    try {
      const port = await health.whenListening;
      const { status, body } = await fetchReady(port);
      assert.equal(status, 503);
      assert.equal(body.status, "not_ready");
      assert.equal(body.bootstrapState, "historical_backfill");
      assert.equal(body.incident, "bootstrap_range_not_enumerated");
      assertSvmIngestReadyServedFacts(body);
      assert.equal(
        classifySvmIngestReadySurface(
          body as unknown as ReturnType<typeof buildSvmIngestReadyPayload>,
        ),
        "bootstrap_incomplete",
      );
    } finally {
      await health.close();
    }
  });
});
