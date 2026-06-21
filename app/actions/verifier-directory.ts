"use server";

import { fetchNostrProfileServer } from "@/lib/nostr/fetch-profile-server";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type VerifierDirectoryEntry = {
  address: `0x${string}`;
  category: number;
  name: string;
  slug: string;
  metadataURI: string;
  active: boolean;
  verificationCount: number;
  joinedAt: number;
  nostrPicture: string | null;
};

export type VerifierDirectoryResult = {
  verifiers: VerifierDirectoryEntry[];
};

type ParsedVerifierDirectoryEntry = Omit<VerifierDirectoryEntry, "nostrPicture">;

type PonderVerifiersRawResponse = {
  verifiers: Array<{
    id?: string;
    address: string;
    category: number;
    name: string;
    slug?: string;
    metadataURI: string;
    active: boolean;
    verificationCount: number;
    joinedAt?: string | number;
  }>;
};

function parseVerifierEntry(
  row: PonderVerifiersRawResponse["verifiers"][number],
): ParsedVerifierDirectoryEntry | null {
  const address = (row.address || row.id || "").trim();
  if (!address.startsWith("0x")) return null;
  return {
    address: address as `0x${string}`,
    category: Number(row.category ?? 5),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    metadataURI: String(row.metadataURI ?? ""),
    active: row.active === true,
    verificationCount: Number(row.verificationCount ?? 0),
    joinedAt: Number(row.joinedAt ?? 0),
  };
}

export async function getVerifierDirectory(): Promise<VerifierDirectoryResult> {
  try {
    const res = await fetch(`${PONDER_URL}/verifiers`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return { verifiers: [] };
    const data = (await res.json()) as PonderVerifiersRawResponse;
    const verifiers = (data.verifiers ?? [])
      .map(parseVerifierEntry)
      .filter((v): v is ParsedVerifierDirectoryEntry => v != null);

    const nostrSettled = await Promise.allSettled(
      verifiers.map((v) => fetchNostrProfileServer(v.address)),
    );

    const nostrResults = nostrSettled.map((result) =>
      result.status === "fulfilled"
        ? result.value.picture?.trim() || null
        : null,
    );

    return {
      verifiers: verifiers.map((entry, i) => ({
        ...entry,
        nostrPicture: nostrResults[i] ?? null,
      })),
    };
  } catch {
    return { verifiers: [] };
  }
}
