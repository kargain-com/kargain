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
 * Registration: skip `ponder.on` when createConfig omitted the contract
 * (e.g. local-only e2e without a bridge gateway). Ponder build fails if a
 * handler names an unregistered contract. No address invention.
 *
 * Event name → decoded args: see ponder-optional-contract-events.ts.
 */

import { ponder } from "ponder:registry";

import ponderConfig from "../../ponder.config.ts";

import type {
  OptionalContractEventArgs,
  OptionalContractEventName,
  OptionalContractName,
} from "./ponder-optional-contract-events";

export {
  listOptionalContractEventKeys,
  OPTIONAL_CONTRACT_ABIS,
  type OptionalContractEventArgs,
  type OptionalContractEventName,
  type OptionalContractName,
} from "./ponder-optional-contract-events";

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

/** Structural event envelope — `args` narrowed by the registered event name. */
export type IndexingEventEnvelope<Args = Record<string, unknown>> = {
  args: Args;
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

export type OptionalContractIndexingArgs<
  N extends OptionalContractEventName = OptionalContractEventName,
> = {
  event: IndexingEventEnvelope<OptionalContractEventArgs<N>>;
  context: IndexingContext;
};

/**
 * Register a handler for an optionally-configured commercial contract.
 *
 * Sole cast: Ponder's EventNames omits optional createConfig keys (address
 * conditional), so those names are not in `ponder.on`'s union even when the
 * contract is registered. The cast goes through `unknown` because Ponder's
 * handler parameter type (always-registered events only) does not overlap
 * OptionalContractIndexingArgs. Claim holds because (1) names are
 * ABI-validated via OptionalContractEventName, (2) args are
 * ContractEventArgsFromTopics for that name, (3) registration is skipped
 * when createConfig omitted the contract (same object ponder.config exported).
 */
export function isOptionalContractInCreateConfig(
  name: OptionalContractName,
): boolean {
  return Object.prototype.hasOwnProperty.call(ponderConfig.contracts, name);
}

export function onOptionalContractEvent<N extends OptionalContractEventName>(
  name: N,
  indexingFunction: (
    args: OptionalContractIndexingArgs<N>,
  ) => Promise<void> | void,
): void {
  const contract = name.slice(0, name.indexOf(":")) as OptionalContractName;
  if (!isOptionalContractInCreateConfig(contract)) return;

  type OptionalOn = <EventName extends OptionalContractEventName>(
    eventName: EventName,
    fn: (args: OptionalContractIndexingArgs<EventName>) => Promise<void> | void,
  ) => void;
  (ponder.on as unknown as OptionalOn)(name, indexingFunction);
}
