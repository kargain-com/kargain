/**
 * /live + /ready for svm-ingest (separate from Ponder reserved routes).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type HealthSnapshot = {
  ready: boolean;
  bootstrapState: string | null;
  incident: string | null;
  lagSlots: number;
  lastContiguousSlot: number;
};

/** Declared facts on `/ready` — missing or undeclared served keys fail. */
export const SVM_INGEST_READY_SERVED_FACTS = [
  "status",
  "bootstrapState",
  "incident",
  "lagSlots",
  "lastContiguousSlot",
] as const;

export type SvmIngestReadyServedFact =
  (typeof SVM_INGEST_READY_SERVED_FACTS)[number];

export type SvmIngestReadyPayload = {
  status: "ready" | "not_ready";
  bootstrapState: string | null;
  incident: string | null;
  lagSlots: number;
  lastContiguousSlot: number;
};

export function buildSvmIngestReadyPayload(
  snap: HealthSnapshot,
): SvmIngestReadyPayload {
  return {
    status: snap.ready ? "ready" : "not_ready",
    bootstrapState: snap.bootstrapState,
    incident: snap.incident,
    lagSlots: snap.lagSlots,
    lastContiguousSlot: snap.lastContiguousSlot,
  };
}

export function assertSvmIngestReadyServedFacts(
  body: Record<string, unknown>,
): void {
  const served = Object.keys(body).sort();
  const expected: string[] = [...SVM_INGEST_READY_SERVED_FACTS].sort();
  const missing = expected.filter((k) => !served.includes(k));
  const extra = served.filter((k) => !expected.includes(k));
  if (missing.length > 0) {
    throw new Error(
      `svm_ingest_ready_declared_fact_missing: ${missing.join(",")}`,
    );
  }
  if (extra.length > 0) {
    throw new Error(
      `svm_ingest_ready_undeclared_fact_served: ${extra.join(",")}`,
    );
  }
}

/** Classify readiness surface for operators — bootstrap ≠ caught up ≠ incident. */
export function classifySvmIngestReadySurface(payload: SvmIngestReadyPayload):
  | "caught_up"
  | "bootstrap_incomplete"
  | "incident" {
  if (payload.status === "ready") return "caught_up";
  if (payload.bootstrapState != null) return "bootstrap_incomplete";
  if (payload.incident != null) return "incident";
  return "bootstrap_incomplete";
}

export function createSvmIngestHealthServer(args: {
  port: number;
  getSnapshot: () => HealthSnapshot;
}): { close: () => Promise<void>; whenListening: Promise<number> } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url === "/live") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "live" }));
      return;
    }
    if (url === "/ready") {
      const snap = args.getSnapshot();
      const payload = buildSvmIngestReadyPayload(snap);
      assertSvmIngestReadyServedFacts(payload);
      const code = snap.ready ? 200 : 503;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const whenListening = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, "0.0.0.0", () => {
      const address = server.address();
      const boundPort =
        typeof address === "object" && address != null ? address.port : args.port;
      resolve(boundPort);
    });
  });

  return {
    whenListening,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
