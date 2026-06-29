const XMTP_OPT_IN_PREFIX = "xmtp:opted-in:";
const XMTP_DISABLED_PREFIX = "xmtp:disabled:";

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function optInKey(address: string): string {
  return `${XMTP_OPT_IN_PREFIX}${normalizeAddress(address)}`;
}

function disabledKey(address: string): string {
  return `${XMTP_DISABLED_PREFIX}${normalizeAddress(address)}`;
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
