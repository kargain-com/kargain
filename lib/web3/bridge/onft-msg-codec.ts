/**
 * ONFT721 message codec — byte-identical with `@layerzerolabs/onft-evm`
 * ONFT721MsgCodec and `kargain-onft-codec` (Rust).
 *
 * Layout: sendTo [0,32) · tokenId [32,64) · compose iff len>64.
 * Compose = composeFrom (32) ‖ abi.encode(string uri). Receiver skips 32
 * sender bytes before ABI-decoding the URI (SPEC §I.13.3 / D-16).
 */
import {
  encodeAbiParameters,
  encodePacked,
  hexToBytes,
  padHex,
  toBytes,
  toHex,
  type Hex,
} from "viem";

export const SEND_TO_OFFSET = 32;
export const TOKEN_ID_OFFSET = 64;
export const SENDER_BYTES = 32;

/** SVM fail-closed named errors (D-16). EVM may continue with uri="" — asymmetric. */
export type OnftComposeErrorName = "ComposeRequired" | "ComposeUndecodable";

export type OnftMessage = {
  sendTo: Uint8Array;
  tokenId: Uint8Array;
  /** Full compose region including the 32-byte composeFrom prefix, if composed. */
  compose: Uint8Array | null;
};

export function isComposed(message: Uint8Array): boolean {
  return message.length > TOKEN_ID_OFFSET;
}

/** `tokenId = (namespace << 128) | localSeq` as 32-byte big-endian. */
export function tokenIdFromParts(
  namespace: bigint | number,
  localSeq: bigint | number = 0n,
): Uint8Array {
  const tid = (BigInt(namespace) << 128n) | BigInt(localSeq);
  return hexToBytes(padHex(toHex(tid), { size: 32 }));
}

/** Left-pad a 20-byte EVM address into a 32-byte sendTo key. */
export function evmAddressToSendTo(addr20: Uint8Array | Hex): Uint8Array {
  const bytes =
    typeof addr20 === "string" ? hexToBytes(padHex(addr20, { size: 20 })) : addr20;
  if (bytes.length !== 20) {
    throw new Error(`evmAddressToSendTo: expected 20 bytes, got ${bytes.length}`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 12);
  return out;
}

/** Solidity `abi.encode(string)` — matches Rust `abi_encode_string` / viem. */
export function abiEncodeString(uri: string): Uint8Array {
  return hexToBytes(encodeAbiParameters([{ type: "string" }], [uri]));
}

/**
 * Encode like ONFT721MsgCodec.encode(sendTo, tokenId, composeMsg).
 * `composeInner` is the inner payload (typically ABI-encoded URI) — without
 * composeFrom. When present, a 32-byte zero composeFrom placeholder is prepended
 * (endpoint fills sender on-chain; local round-trips use zeros).
 */
export function encodeOnftMessage(
  sendTo: Uint8Array,
  tokenId: Uint8Array,
  composeInner: Uint8Array | null,
): { message: Uint8Array; hasCompose: boolean } {
  if (sendTo.length !== 32 || tokenId.length !== 32) {
    throw new Error("encodeOnftMessage: sendTo and tokenId must be 32 bytes");
  }
  const sendToHex = toHex(sendTo);
  const tokenIdHex = toHex(tokenId);
  if (composeInner == null) {
    return {
      message: hexToBytes(
        encodePacked(["bytes32", "uint256"], [sendToHex, BigInt(tokenIdHex)]),
      ),
      hasCompose: false,
    };
  }
  const message = hexToBytes(
    encodePacked(
      ["bytes32", "uint256", "bytes32", "bytes"],
      [
        sendToHex,
        BigInt(tokenIdHex),
        padHex("0x0", { size: 32 }),
        toHex(composeInner),
      ],
    ),
  );
  return { message, hasCompose: true };
}

export function decodeOnftMessage(message: Uint8Array): OnftMessage {
  if (message.length < TOKEN_ID_OFFSET) {
    throw new Error("TooShort");
  }
  return {
    sendTo: message.slice(0, SEND_TO_OFFSET),
    tokenId: message.slice(SEND_TO_OFFSET, TOKEN_ID_OFFSET),
    compose:
      message.length > TOKEN_ID_OFFSET
        ? message.slice(TOKEN_ID_OFFSET)
        : null,
  };
}

/**
 * URI from compose, skipping composeFrom. Fail-closed (SVM D-16).
 * Empty string after a valid ABI encode of "" is ok.
 */
export function uriFailClosed(
  decoded: OnftMessage,
): { ok: true; uri: string } | { ok: false; error: OnftComposeErrorName } {
  if (decoded.compose == null) {
    return { ok: false, error: "ComposeRequired" };
  }
  if (decoded.compose.length <= SENDER_BYTES) {
    return { ok: false, error: "ComposeRequired" };
  }
  try {
    const uri = decodeAbiString(decoded.compose.slice(SENDER_BYTES));
    return { ok: true, uri };
  } catch {
    return { ok: false, error: "ComposeUndecodable" };
  }
}

/** Decode Solidity `abi.encode(string)` payload (no composeFrom). */
export function decodeAbiString(data: Uint8Array): string {
  if (data.length < 64) {
    throw new Error("InvalidAbiString");
  }
  const offset = Number(u64Be(data.subarray(0, 32)));
  if (offset + 32 > data.length) {
    throw new Error("InvalidAbiString");
  }
  const len = Number(u64Be(data.subarray(offset, offset + 32)));
  const start = offset + 32;
  const end = start + len;
  if (end > data.length) {
    throw new Error("InvalidAbiString");
  }
  return new TextDecoder().decode(data.subarray(start, end));
}

function u64Be(word: Uint8Array): bigint {
  let n = 0n;
  for (let i = 24; i < 32; i++) {
    n = (n << 8n) | BigInt(word[i]!);
  }
  return n;
}

/** Build a wire message with a raw compose-extension of exact byte length. */
export function messageWithComposeExtension(
  sendTo: Uint8Array,
  tokenId: Uint8Array,
  extension: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(TOKEN_ID_OFFSET + extension.length);
  out.set(sendTo, 0);
  out.set(tokenId, SEND_TO_OFFSET);
  out.set(extension, TOKEN_ID_OFFSET);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function hexToUint8Array(hex: string): Uint8Array {
  const cleaned = hex.trim().replace(/^0x/i, "");
  return toBytes(`0x${cleaned}` as Hex);
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return toHex(bytes).slice(2);
}
