/**
 * Sole borsh body decoder for SVM structured event payloads (SPEC §13.12 encoding table).
 * Discriminator is stripped before decode; manifest drives field order.
 */

import eventsManifest from "../../svm/crates/kargain-events/events.manifest.json" with {
  type: "json",
};

import { splitDiscriminatorAndBody } from "./event-discriminators.js";

export type ManifestFieldEncoding =
  | "bytes32"
  | "pubkey32"
  | "u64"
  | "u32"
  | "u16"
  | "u8"
  | "borsh_string";

export type DecodedEventField = {
  name: string;
  encoding: ManifestFieldEncoding;
  value: string | bigint | number | Uint8Array;
};

export type DecodedEventPayload = {
  contract: string;
  event: string;
  fields: DecodedEventField[];
};

type ManifestEntry = {
  contract: string;
  event: string;
  fields: Array<{
    name: string;
    encoding: string;
  }>;
};

const MANIFEST_ENTRIES = eventsManifest.entries as ManifestEntry[];

function manifestKey(contract: string, event: string): string {
  return `${contract}:${event}`;
}

const FIELDS_BY_EVENT = new Map<string, ManifestEntry["fields"]>(
  MANIFEST_ENTRIES.map((e) => [manifestKey(e.contract, e.event), e.fields]),
);

export class EventPayloadDecodeError extends Error {
  readonly name = "EventPayloadDecodeError";
}

function readU8(buf: Buffer, offset: number): { value: number; next: number } {
  if (offset >= buf.length) throw new EventPayloadDecodeError("unexpected EOF reading u8");
  return { value: buf[offset]!, next: offset + 1 };
}

function readU16LE(buf: Buffer, offset: number): { value: number; next: number } {
  if (offset + 2 > buf.length) throw new EventPayloadDecodeError("unexpected EOF reading u16");
  return { value: buf.readUInt16LE(offset), next: offset + 2 };
}

function readU32LE(buf: Buffer, offset: number): { value: number; next: number } {
  if (offset + 4 > buf.length) throw new EventPayloadDecodeError("unexpected EOF reading u32");
  return { value: buf.readUInt32LE(offset), next: offset + 4 };
}

function readU64LE(buf: Buffer, offset: number): { value: bigint; next: number } {
  if (offset + 8 > buf.length) throw new EventPayloadDecodeError("unexpected EOF reading u64");
  return { value: buf.readBigUInt64LE(offset), next: offset + 8 };
}

function readFixed32(buf: Buffer, offset: number): { value: Uint8Array; next: number } {
  if (offset + 32 > buf.length) throw new EventPayloadDecodeError("unexpected EOF reading [u8;32]");
  return { value: buf.subarray(offset, offset + 32), next: offset + 32 };
}

function readBorshString(buf: Buffer, offset: number): { value: string; next: number } {
  const len = readU32LE(buf, offset);
  const start = len.next;
  const end = start + len.value;
  if (end > buf.length) throw new EventPayloadDecodeError("unexpected EOF reading borsh string");
  return { value: buf.subarray(start, end).toString("utf8"), next: end };
}

function decodeField(
  buf: Buffer,
  offset: number,
  encoding: ManifestFieldEncoding,
): { field: DecodedEventField; next: number } {
  switch (encoding) {
    case "bytes32": {
      const r = readFixed32(buf, offset);
      return {
        field: { name: "", encoding, value: r.value },
        next: r.next,
      };
    }
    case "pubkey32": {
      const r = readFixed32(buf, offset);
      return {
        field: { name: "", encoding, value: r.value },
        next: r.next,
      };
    }
    case "u64": {
      const r = readU64LE(buf, offset);
      return { field: { name: "", encoding, value: r.value }, next: r.next };
    }
    case "u32": {
      const r = readU32LE(buf, offset);
      return { field: { name: "", encoding, value: r.value }, next: r.next };
    }
    case "u16": {
      const r = readU16LE(buf, offset);
      return { field: { name: "", encoding, value: r.value }, next: r.next };
    }
    case "u8": {
      const r = readU8(buf, offset);
      return { field: { name: "", encoding, value: r.value }, next: r.next };
    }
    case "borsh_string": {
      const r = readBorshString(buf, offset);
      return { field: { name: "", encoding, value: r.value }, next: r.next };
    }
    default:
      throw new EventPayloadDecodeError(`unsupported encoding ${String(encoding)}`);
  }
}

/** Global tokenId decimal string from 32-byte BE `(namespace || localSeq)`. */
export function tokenIdFromBytes32(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new EventPayloadDecodeError("tokenId bytes32 must be 32 bytes");
  }
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return value.toString();
}

export function decodeEventPayloadBody(args: {
  contractName: string;
  eventName: string;
  payloadBytes: Buffer;
}): DecodedEventPayload {
  const split = splitDiscriminatorAndBody(args.payloadBytes);
  if (!split) throw new EventPayloadDecodeError("payload shorter than discriminator");

  const manifestFields = FIELDS_BY_EVENT.get(
    manifestKey(args.contractName, args.eventName),
  );
  if (!manifestFields) {
    throw new EventPayloadDecodeError(
      `no manifest entry for ${args.contractName}:${args.eventName}`,
    );
  }

  const fields: DecodedEventField[] = [];
  let offset = 0;
  for (const spec of manifestFields) {
    const encoding = spec.encoding as ManifestFieldEncoding;
    const decoded = decodeField(split.body, offset, encoding);
    fields.push({ name: spec.name, encoding, value: decoded.field.value });
    offset = decoded.next;
  }
  if (offset !== split.body.length) {
    throw new EventPayloadDecodeError(
      `trailing ${split.body.length - offset} bytes after ${args.eventName}`,
    );
  }

  return { contract: args.contractName, event: args.eventName, fields };
}

export function fieldString(fields: DecodedEventField[], name: string): string {
  const f = fields.find((x) => x.name === name);
  if (!f || typeof f.value !== "string") {
    throw new EventPayloadDecodeError(`missing string field ${name}`);
  }
  return f.value;
}

export function fieldBytes32(fields: DecodedEventField[], name: string): Uint8Array {
  const f = fields.find((x) => x.name === name);
  if (!f || !(f.value instanceof Uint8Array)) {
    throw new EventPayloadDecodeError(`missing bytes32 field ${name}`);
  }
  return f.value;
}

export function fieldPubkey32(fields: DecodedEventField[], name: string): Uint8Array {
  const f = fields.find((x) => x.name === name);
  if (!f || !(f.value instanceof Uint8Array)) {
    throw new EventPayloadDecodeError(`missing pubkey32 field ${name}`);
  }
  return f.value;
}
