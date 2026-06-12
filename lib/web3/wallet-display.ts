import { getAddress } from "viem";

/** Nav-style address: `0x1a2b·ef3d` */
export function navShortAddress(address: string): string {
  try {
    const normalized = getAddress(address as `0x${string}`);
    return `${normalized.slice(0, 6)}·${normalized.slice(-4)}`;
  } catch {
    return address.length > 10 ? `${address.slice(0, 6)}·${address.slice(-4)}` : address;
  }
}

/** Deterministic identicon hue from wallet address (0–359). */
export function identiconHue(address: string): number {
  const hex = address.startsWith("0x") ? address.slice(2, 8) : address.slice(0, 6);
  return Number.parseInt(hex.padEnd(6, "0").slice(0, 6), 16) % 360;
}

export function identiconBackground(address: string): string {
  return `hsl(${identiconHue(address)}, 55%, 50%)`;
}
