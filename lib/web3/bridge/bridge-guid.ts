import { parseEventLogs, type Abi, type Hex, type Log } from "viem";

/** Extract LayerZero ONFT send GUID from a transaction receipt's ONFTSent log. */
export function onftSentGuidFromLogs(abi: Abi, logs: readonly Log[]): Hex {
  const parsed = parseEventLogs({
    abi,
    eventName: "ONFTSent",
    logs: [...logs],
  });
  const first = parsed[0] as
    | { args?: { guid?: unknown } }
    | undefined;
  const guid = first?.args?.guid;
  if (typeof guid !== "string" || !guid.startsWith("0x")) {
    throw new Error("ONFTSent guid missing from transaction logs");
  }
  return guid as Hex;
}
