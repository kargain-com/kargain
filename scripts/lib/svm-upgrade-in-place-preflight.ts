/**
 * Pure helpers for upgrade-in-place planned-change reporting (Phase 1 dry-run).
 */

export function maskBase58Id(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function sanitizeCliDetail(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)"']+/gi, "<RPC>")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (id) =>
      id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`,
    )
    .trim();
}

export function isTransportCliFailure(detail: string): boolean {
  return /error sending request|timed out|ECONNRESET|socket hang up|429|rate.?limit|502|503|504/i.test(
    detail,
  );
}

/** True absent — not a transport AccountNotFound wrapper. */
export function isAbsentProgramShowFailure(detail: string): boolean {
  if (isTransportCliFailure(detail)) return false;
  return /unable to find|could not find the account|Program account not found/i.test(
    detail,
  );
}

export type UpgradePlannedChangeRow = {
  evidenceKey: string;
  maskedProgramId: string;
  priorDigest: string;
  newDigest: string;
  priorDeploySlot: string;
  soBytes: number;
  deployedCapacityBytes: number;
  fits: "yes" | "no";
  deficitBytes: number;
};

export type UpgradeProgramOutcome = "upgraded" | "skipped" | "failed";

export type UpgradeProgramStatusRow = {
  evidenceKey: string;
  maskedProgramId: string;
  outcome: UpgradeProgramOutcome;
  detail: string;
};

export function formatUpgradePlannedChangeTable(
  rows: readonly UpgradePlannedChangeRow[],
): string {
  const lines = [
    "program | registry id | prior digest | new digest | prior deploySlot | soBytes | deployedCapacity | fits | deficit",
    "--------|-------------|--------------|------------|------------------|---------|------------------|------|---------",
  ];
  for (const row of rows) {
    lines.push(
      [
        row.evidenceKey,
        row.maskedProgramId,
        row.priorDigest,
        row.newDigest,
        row.priorDeploySlot,
        String(row.soBytes),
        String(row.deployedCapacityBytes),
        row.fits,
        String(row.deficitBytes),
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

export function formatUpgradeProgramStatusTable(
  rows: readonly UpgradeProgramStatusRow[],
): string {
  const lines = [
    "program | registry id | outcome | detail",
    "--------|-------------|---------|--------",
  ];
  for (const row of rows) {
    lines.push(
      [row.evidenceKey, row.maskedProgramId, row.outcome, row.detail].join(
        " | ",
      ),
    );
  }
  return lines.join("\n");
}

/**
 * Parse `solana rent <n> --lamports` stdout → lamports integer.
 * Example: `Rent-exempt minimum: 1331691520 lamports`
 */
export function parseRentExemptLamports(rentCliText: string): number {
  const match = rentCliText.match(
    /Rent-exempt minimum:\s*([\d_]+)\s*lamports/i,
  );
  if (!match) {
    throw new Error(
      `solana rent output missing rent-exempt lamports line (got ${JSON.stringify(rentCliText.trim().slice(0, 120))})`,
    );
  }
  const n = Number(match[1]!.replace(/_/g, ""));
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`solana rent produced non-integer lamports: ${match[1]}`);
  }
  return n;
}

/**
 * Parse `solana balance ... --lamports` stdout.
 * Example: `19130523350 lamports`
 */
export function parseBalanceLamports(balanceCliText: string): number {
  const match = balanceCliText.trim().match(/^([\d_]+)\s*lamports\b/i);
  if (!match) {
    throw new Error(
      `solana balance --lamports output unparseable (got ${JSON.stringify(balanceCliText.trim().slice(0, 120))})`,
    );
  }
  const n = Number(match[1]!.replace(/_/g, ""));
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`solana balance produced non-integer lamports: ${match[1]}`);
  }
  return n;
}

export function parseProgramShowAuthority(showText: string): {
  ownerLine: string | null;
  authority: string | null;
} {
  const ownerMatch = showText.match(/Owner:\s*(\S+)/i);
  const authMatch = showText.match(/Authority:\s*(\S+)/);
  return {
    ownerLine: ownerMatch?.[1] ?? null,
    authority: authMatch?.[1] ?? null,
  };
}
