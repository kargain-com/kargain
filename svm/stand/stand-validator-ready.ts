/**
 * Sole stand validator readiness owner.
 *
 * First transaction must not fire until both RPC and websocket ports answer.
 * Named refuse with port + elapsed ms. No blind sleep-as-readiness
 * (poll interval between probes only).
 */

export const STAND_RPC_NOT_READY = "stand_rpc_not_ready" as const;
export const STAND_WEBSOCKET_NOT_READY = "stand_websocket_not_ready" as const;
export const STAND_PORT_IN_USE = "stand_port_in_use" as const;
export const STAND_HARDHAT_CONFLICT = "stand_hardhat_conflict" as const;

export const STAND_DEFAULT_RPC_URL = "http://127.0.0.1:8899";
export const STAND_DEFAULT_WS_URL = "ws://127.0.0.1:8900";
export const STAND_DEFAULT_RPC_PORT = 8899;
export const STAND_DEFAULT_WS_PORT = 8900;
export const STAND_HARDHAT_PORT = 8545;

/** Overall readiness budget (ms). */
export const STAND_READY_BUDGET_MS = 90_000 as const;
/** Interval between readiness probes (ms) — not a blind pre-sleep. */
export const STAND_READY_POLL_INTERVAL_MS = 250 as const;

export type StandReadyPorts = {
  /** Return true when JSON-RPC getHealth reports ok. */
  probeRpc: () => Promise<boolean>;
  /** Return true when the websocket port accepts a connection. */
  probeWebsocket: () => Promise<boolean>;
  nowMs?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
  budgetMs?: number;
  pollIntervalMs?: number;
  rpcPort?: number;
  wsPort?: number;
};

/**
 * Wait until RPC and websocket both answer, or refuse by name.
 */
export async function waitStandValidatorReady(
  ports: StandReadyPorts,
): Promise<{ elapsedMs: number }> {
  const nowMs = ports.nowMs ?? (() => Date.now());
  const sleepMs =
    ports.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const budgetMs = ports.budgetMs ?? STAND_READY_BUDGET_MS;
  const pollIntervalMs = ports.pollIntervalMs ?? STAND_READY_POLL_INTERVAL_MS;
  const rpcPort = ports.rpcPort ?? STAND_DEFAULT_RPC_PORT;
  const wsPort = ports.wsPort ?? STAND_DEFAULT_WS_PORT;
  const started = nowMs();
  const deadline = started + budgetMs;

  let rpcOk = false;
  let wsOk = false;

  while (nowMs() < deadline) {
    if (!rpcOk) {
      rpcOk = await ports.probeRpc();
    }
    if (!wsOk) {
      wsOk = await ports.probeWebsocket();
    }
    if (rpcOk && wsOk) {
      return { elapsedMs: nowMs() - started };
    }
    await sleepMs(pollIntervalMs);
  }

  const elapsedMs = nowMs() - started;
  if (!rpcOk) {
    throw new Error(
      `${STAND_RPC_NOT_READY}: port=${rpcPort} elapsedMs=${elapsedMs} budgetMs=${budgetMs}`,
    );
  }
  throw new Error(
    `${STAND_WEBSOCKET_NOT_READY}: port=${wsPort} elapsedMs=${elapsedMs} budgetMs=${budgetMs}`,
  );
}

export type StandIsolationPorts = {
  /** True if something already accepts connections on the port. */
  isPortAccepting: (port: number) => Promise<boolean>;
  /** When true, Hardhat on 8545 is intentional (KARGAIN_SVM_STAND_EVM=1). */
  allowHardhat?: boolean;
  rpcPort?: number;
  wsPort?: number;
  hardhatPort?: number;
};

/**
 * Refuse when stand ports are already bound, or Hardhat listens on 8545
 * without STAND_EVM. Residual: foreign Node workers that do not hold these
 * ports cannot be detected from port probes alone.
 */
export async function assertStandIsolation(
  ports: StandIsolationPorts,
): Promise<void> {
  const rpcPort = ports.rpcPort ?? STAND_DEFAULT_RPC_PORT;
  const wsPort = ports.wsPort ?? STAND_DEFAULT_WS_PORT;
  const hardhatPort = ports.hardhatPort ?? STAND_HARDHAT_PORT;

  if (await ports.isPortAccepting(rpcPort)) {
    throw new Error(
      `${STAND_PORT_IN_USE}: port=${rpcPort} (stand RPC already accepting — refuse conflicting run)`,
    );
  }
  if (await ports.isPortAccepting(wsPort)) {
    throw new Error(
      `${STAND_PORT_IN_USE}: port=${wsPort} (stand websocket already accepting — refuse conflicting run)`,
    );
  }
  if (!ports.allowHardhat && (await ports.isPortAccepting(hardhatPort))) {
    throw new Error(
      `${STAND_HARDHAT_CONFLICT}: port=${hardhatPort} accepting without KARGAIN_SVM_STAND_EVM=1 ` +
        `(parallel Hardhat is a known SIGSEGV class — run the stand alone)`,
    );
  }
}

/** JSON-RPC getHealth probe for http(s) URL. */
export async function probeStandRpcHealth(
  rpcUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: [],
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: unknown };
    return body.result === "ok";
  } catch {
    return false;
  }
}

/**
 * TCP connect probe — proves the websocket port is listening without a full
 * Solana pubsub handshake (enough to catch ECONNREFUSED-class boots).
 */
export async function probeStandTcpPort(
  host: string,
  port: number,
  connectImpl?: (host: string, port: number) => Promise<boolean>,
): Promise<boolean> {
  if (connectImpl) return connectImpl(host, port);
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function standReadyPortsForLocalValidator(opts?: {
  rpcUrl?: string;
  wsHost?: string;
  wsPort?: number;
  fetchImpl?: typeof fetch;
}): StandReadyPorts {
  const rpcUrl = opts?.rpcUrl ?? STAND_DEFAULT_RPC_URL;
  const wsHost = opts?.wsHost ?? "127.0.0.1";
  const wsPort = opts?.wsPort ?? STAND_DEFAULT_WS_PORT;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  return {
    rpcPort: STAND_DEFAULT_RPC_PORT,
    wsPort,
    probeRpc: () => probeStandRpcHealth(rpcUrl, fetchImpl),
    probeWebsocket: () => probeStandTcpPort(wsHost, wsPort),
  };
}

export async function isLocalPortAccepting(port: number): Promise<boolean> {
  return probeStandTcpPort("127.0.0.1", port);
}

/**
 * One-shot dual readiness (RPC getHealth + websocket TCP). Used by LIVE
 * probeValidator — run-stand already waited; this refuses races where WS dies.
 */
export async function isStandValidatorReadyNow(opts?: {
  rpcUrl?: string;
  wsHost?: string;
  wsPort?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const ports = standReadyPortsForLocalValidator(opts);
  const rpcOk = await ports.probeRpc();
  if (!rpcOk) return false;
  return ports.probeWebsocket();
}
