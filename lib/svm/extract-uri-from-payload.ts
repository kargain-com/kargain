/**
 * Extract metadata URI from KarPassport structured payloads (S7c-4).
 */

import type { StructuredPayloadDraft } from "./parse-transaction-ingest.js";
import {
  decodeEventPayloadBody,
  fieldString,
} from "./event-payload-decode.js";

const URI_EVENTS = new Set([
  "PassportMinted",
  "PassportBridgeMinted",
  "PassportURIUpdated",
]);

export function uriFromStructuredPayload(
  payload: Pick<
    StructuredPayloadDraft,
    "contractName" | "eventName" | "payloadBytes"
  >,
): string | null {
  if (payload.contractName !== "KarPassport") return null;
  if (!URI_EVENTS.has(payload.eventName)) return null;

  let decoded;
  try {
    decoded = decodeEventPayloadBody({
      contractName: payload.contractName,
      eventName: payload.eventName,
      payloadBytes: payload.payloadBytes,
    });
  } catch {
    return null;
  }

  if (payload.eventName === "PassportURIUpdated") {
    const uri = fieldString(decoded.fields, "newURI").trim();
    return uri || null;
  }

  const uri = fieldString(decoded.fields, "uri").trim();
  return uri || null;
}
