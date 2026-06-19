"use client";

import { IdentifierKind, isText, type Client, type DecodedMessage } from "@xmtp/client";
import { getAddress } from "viem";

export { shortAddress } from "@/lib/web3/wallet-display";

export function truncatePreview(text: string, max = 60): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function messageText(message: DecodedMessage): string {
  if (isText(message)) return String(message.content ?? "");
  return message.fallback ?? "…";
}

export function lastSeenKey(conversationId: string): string {
  return `xmtp:lastseen:${conversationId}`;
}

export function getLastSeen(conversationId: string): Date | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(lastSeenKey(conversationId));
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function setLastSeen(conversationId: string, at: Date = new Date()): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(lastSeenKey(conversationId), at.toISOString());
  window.dispatchEvent(new CustomEvent("xmtp:lastseen-updated", { detail: { conversationId } }));
}

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export type XmtpClient = Awaited<ReturnType<typeof Client.create>>;

export function getClientEthereumAddress(client: XmtpClient): `0x${string}` | null {
  const identifier = client.accountIdentifier;
  if (!identifier || identifier.identifierKind !== IdentifierKind.Ethereum) return null;
  try {
    return getAddress(identifier.identifier as `0x${string}`);
  } catch {
    return null;
  }
}

export function ethereumAddressFromInboxState(
  state: { accountIdentifiers: Array<{ identifier: string; identifierKind: number }> } | undefined,
): `0x${string}` | null {
  if (!state) return null;
  const eth = state.accountIdentifiers.find((id) => id.identifierKind === IdentifierKind.Ethereum);
  if (!eth) return null;
  try {
    return getAddress(eth.identifier as `0x${string}`);
  } catch {
    return null;
  }
}

export function dateToSentAfterNs(date: Date): bigint {
  return BigInt(date.getTime()) * 1_000_000n;
}
