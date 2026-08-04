/**
 * Pure installation readout mapping for messaging device management (§4.12).
 * Surfaces compose display data; they do not invent age labels locally.
 */

import type { InstallationReadout } from "@/lib/messaging/ports";

export type InstallationDisplay = {
  count: number;
  currentInstallationId: string | null;
  rows: Array<{ id: string; ageLabel: string; isCurrent: boolean }>;
};

/** Settings mounts devices only when a local client already exists (no demand). */
export function shouldShowMessagingDevices(input: {
  client: unknown | null | undefined;
}): boolean {
  return input.client != null;
}

export function formatInstallationAge(createdAtMs: number | null, nowMs: number): string {
  if (createdAtMs === null) return "age unknown";
  const ageMs = Math.max(0, nowMs - createdAtMs);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

export function toInstallationDisplay(
  readout: InstallationReadout,
  nowMs: number,
): InstallationDisplay {
  return {
    count: readout.installations.length,
    currentInstallationId: readout.currentInstallationId,
    rows: readout.installations.map((installation) => ({
      id: installation.id,
      ageLabel: formatInstallationAge(installation.createdAtMs, nowMs),
      isCurrent: installation.id === readout.currentInstallationId,
    })),
  };
}
