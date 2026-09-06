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

export function createSvmIngestHealthServer(args: {
  port: number;
  getSnapshot: () => HealthSnapshot;
}): { close: () => Promise<void> } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url === "/live") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "live" }));
      return;
    }
    if (url === "/ready") {
      const snap = args.getSnapshot();
      const code = snap.ready ? 200 : 503;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: snap.ready ? "ready" : "not_ready",
          bootstrapState: snap.bootstrapState,
          incident: snap.incident,
          lagSlots: snap.lagSlots,
          lastContiguousSlot: snap.lastContiguousSlot,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(args.port, "0.0.0.0");
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
