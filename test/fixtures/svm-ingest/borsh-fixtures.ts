/**
 * Borsh program-data builders for SVM ingest/projection fixtures.
 */

import { splitDiscriminatorAndBody } from "../../../lib/svm/event-discriminators.js";

function borshString(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}

function tokenIdBytes32(tokenId: bigint): Buffer {
  const out = Buffer.alloc(32);
  let v = tokenId;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function pubkey32FromSeed(seed: number): Buffer {
  const out = Buffer.alloc(32);
  out[31] = seed & 0xff;
  return out;
}

export function buildProgramDataLine(args: {
  discriminatorHex: string;
  body: Buffer;
}): string {
  const disc = Buffer.from(args.discriminatorHex, "hex");
  const payload = Buffer.concat([disc, args.body]);
  return `Program data: ${payload.toString("base64")}`;
}

export function buildRecordAppendedBody(args: {
  tokenId: bigint;
  authorSeed?: number;
  recordType?: string;
  description?: string;
  evidenceCID?: string;
}): Buffer {
  return Buffer.concat([
    tokenIdBytes32(args.tokenId),
    pubkey32FromSeed(args.authorSeed ?? 1),
    borshString(args.recordType ?? "service"),
    borshString(args.description ?? "SVM fixture record"),
    borshString(args.evidenceCID ?? "ar://fixture-record"),
  ]);
}

export function buildPassportUriUpdatedBody(args: {
  tokenId: bigint;
  newUri: string;
  authorSeed?: number;
}): Buffer {
  return Buffer.concat([
    tokenIdBytes32(args.tokenId),
    borshString(args.newUri),
    pubkey32FromSeed(args.authorSeed ?? 2),
  ]);
}

export const RECORD_APPENDED_DISC = "a4a50441bfe85272";
export const PASSPORT_URI_UPDATED_DISC = "51eaab4a9af303ff";

export function globalTokenId(namespace: number, localSeq: number): bigint {
  return (BigInt(namespace) << 128n) | BigInt(localSeq);
}

/** Decode body only — for unit tests. */
export function decodeFixturePayload(args: {
  discriminatorHex: string;
  body: Buffer;
}): Buffer {
  const payload = Buffer.concat([Buffer.from(args.discriminatorHex, "hex"), args.body]);
  const split = splitDiscriminatorAndBody(payload);
  if (!split) throw new Error("invalid fixture payload");
  return split.body;
}
