/** Decode UTF-8 settlement note bytes from `settlementNotes(tokenId)`. */
export function decodeSettlementNote(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") {
    if (!raw.startsWith("0x")) return raw;
    try {
      const hex = raw.slice(2);
      if (!hex) return "";
      let out = "";
      for (let i = 0; i < hex.length; i += 2) {
        const byte = Number.parseInt(hex.slice(i, i + 2), 16);
        if (byte === 0) break;
        out += String.fromCharCode(byte);
      }
      return out;
    } catch {
      return "";
    }
  }
  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }
  return "";
}
