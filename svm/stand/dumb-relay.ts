/**
 * Dumb cross-VM relay — copies **payload bytes** between mock endpoints.
 * No re-encode, no compose rewrite, no GUID/nonce mutation of the message body.
 * SVM receive rent is paid by the relay fee payer outside this module.
 */

export type StandRelayPacket = {
  srcEid: number;
  dstEid: number;
  /** 32-byte peer / OApp identity on the source. */
  sender: Uint8Array;
  nonce: bigint;
  /** 32-byte GUID. */
  guid: Uint8Array;
  /** Exact ONFT wire bytes — identity-copied only. */
  payload: Uint8Array;
};

function copy32(bytes: Uint8Array, label: string): Uint8Array {
  if (bytes.length !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return new Uint8Array(bytes);
}

/**
 * Identity copy of a packet. Callers must not mutate `payload` in place after
 * enqueue if they need the source buffer preserved — this always clones.
 */
export function relayCopyPayload(packet: StandRelayPacket): StandRelayPacket {
  return {
    srcEid: packet.srcEid,
    dstEid: packet.dstEid,
    sender: copy32(packet.sender, "sender"),
    nonce: packet.nonce,
    guid: copy32(packet.guid, "guid"),
    payload: new Uint8Array(packet.payload),
  };
}

/** Assert two payloads are byte-identical (stand invariant: no re-encode). */
export function assertPayloadUnchanged(sent: Uint8Array, received: Uint8Array): void {
  if (sent.length !== received.length) {
    throw new Error(`payload length drift: sent ${sent.length} received ${received.length}`);
  }
  for (let i = 0; i < sent.length; i++) {
    if (sent[i] !== received[i]) {
      throw new Error(`payload byte drift at index ${i}`);
    }
  }
}
