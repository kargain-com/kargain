const XMTP_OPT_IN_PREFIX = "xmtp:opted-in:";
const XMTP_DISABLED_PREFIX = "xmtp:disabled:";
const XMTP_NETWORK_REGISTERED_PREFIX = "xmtp:network-registered:";

export const NETWORK_REGISTERED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function optInKey(address: string): string {
  return `${XMTP_OPT_IN_PREFIX}${normalizeAddress(address)}`;
}

function disabledKey(address: string): string {
  return `${XMTP_DISABLED_PREFIX}${normalizeAddress(address)}`;
}

function networkRegisteredKey(address: string): string {
  return `${XMTP_NETWORK_REGISTERED_PREFIX}${normalizeAddress(address)}`;
}

function readNetworkRegisteredTimestamp(address: string): number | null {
  if (!storageAvailable()) return null;
  const raw = localStorage.getItem(networkRegisteredKey(address));
  if (raw === null) return null;
  const timestamp = Number(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

export function hasOptedIn(address: string): boolean {
  if (!storageAvailable()) return false;
  return localStorage.getItem(optInKey(address)) === "1";
}

export function setOptedIn(address: string): void {
  if (!storageAvailable()) return;
  localStorage.setItem(optInKey(address), "1");
}

export function clearOptedIn(address: string): void {
  if (!storageAvailable()) return;
  localStorage.removeItem(optInKey(address));
}

export function isMessagingDisabledLocally(address: string): boolean {
  if (!storageAvailable()) return false;
  return localStorage.getItem(disabledKey(address)) === "1";
}

export function setMessagingDisabledLocally(address: string): void {
  if (!storageAvailable()) return;
  localStorage.setItem(disabledKey(address), "1");
}

export function clearMessagingDisabledLocally(address: string): void {
  if (!storageAvailable()) return;
  localStorage.removeItem(disabledKey(address));
}

export function getCachedNetworkRegistered(
  address: string,
  nowMs: number = Date.now(),
): boolean {
  const timestamp = readNetworkRegisteredTimestamp(address);
  if (timestamp === null) return false;
  return nowMs - timestamp < NETWORK_REGISTERED_CACHE_TTL_MS;
}

export function setNetworkRegisteredCache(address: string, nowMs: number = Date.now()): void {
  if (!storageAvailable()) return;
  localStorage.setItem(networkRegisteredKey(address), String(nowMs));
}

export function clearNetworkRegisteredCache(address: string): void {
  if (!storageAvailable()) return;
  localStorage.removeItem(networkRegisteredKey(address));
}
