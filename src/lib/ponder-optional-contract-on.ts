/**
 * Sole registration entry for Ponder handlers on contracts that appear in
 * createConfig only when their addresses resolve (FixedPriceConsignment,
 * AscendingConsignment, KarPassportBridgeGateway).
 *
 * Ponder derives EventNames from createConfig's contracts object. Optional
 * keys surface as `T | undefined` in FormatEventNames and drop those events
 * from the `ponder.on` union — even though the handlers are correct whenever
 * the contract is registered. Always-registered contracts (KarPassport,
 * KarProPass, KarProStaking) continue to use `ponder.on` directly.
 *
 * Runtime: if the contract was not registered, Ponder does not invoke these
 * handlers. No address invention; no unconditional registration.
 */

import { ponder } from "ponder:registry";

export type OptionalContractEventName =
  | `FixedPriceConsignment:${string}`
  | `AscendingConsignment:${string}`
  | `KarPassportBridgeGateway:${string}`;

/**
 * Structural indexing context shared by optional-contract handlers and by
 * commerce helpers that also run from always-registered KarPassport events.
 * Uses the same `db` / `client` shapes `ponder.on` already provides.
 */
export type IndexingContext = {
  chain: { id: number };
  db: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"]["db"];
  client: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"]["client"];
};

/** Structural event envelope — args are narrowed at the handler via `eventArgs`. */
export type IndexingEventEnvelope = {
  args: Record<string, unknown>;
  id: string;
  log: {
    address: `0x${string}`;
    data: `0x${string}`;
    logIndex: number;
    removed: boolean;
    topics: [] | [`0x${string}`, ...`0x${string}`[]];
  };
  block: {
    number: bigint;
    timestamp: bigint;
  };
  transaction: {
    hash: `0x${string}`;
  };
};

export type OptionalContractIndexingArgs = {
  event: IndexingEventEnvelope;
  context: IndexingContext;
};

type OptionalOn = (
  name: OptionalContractEventName,
  indexingFunction: (
    args: OptionalContractIndexingArgs,
  ) => Promise<void> | void,
) => void;

/**
 * Narrow decoded event args for an optionally-registered contract handler.
 * Args arrive as a structural record because EventNames omits these events.
 */
export function eventArgs<T extends Record<string, unknown>>(
  event: IndexingEventEnvelope,
): T {
  return event.args as T;
}

/**
 * Register a handler for an optionally-configured commercial contract.
 * Boundary: EventNames omits these names when the address did not resolve.
 */
export function onOptionalContractEvent(
  name: OptionalContractEventName,
  indexingFunction: (
    args: OptionalContractIndexingArgs,
  ) => Promise<void> | void,
): void {
  (ponder.on as OptionalOn)(name, indexingFunction);
}
