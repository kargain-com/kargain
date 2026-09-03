import { db } from "ponder:api";
import {
  claimCredit,
  commerceClaim,
  commerceClaimCredit,
  pendingClaim,
  verifier,
} from "ponder:schema";
import { and, asc, count, desc, eq, gt, inArray, replaceBigInts, sql } from "ponder";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from "../../lib/kar-pro/kar-pro-slug-rules";
import { buildNotificationFeed } from "./notifications-query";
import { registerCommerceRoutes } from "./commerce-routes";
import { normalizeVerifierId } from "../lib/ponder-verifier-lifecycle";
import {
  countAttestationsByAuthor,
  loadAttestationsByAuthor,
  loadPassportRecordsByTokenId,
  loadPassportUriHistoryByTokenId,
} from "../lib/ponder-passport-provenance";
import {
  countVerifiedPassportsByVerifier,
  loadPassportEntitiesBrowse,
  loadPassportEntitiesByIds,
  loadPassportEntitiesByOwner,
  loadPassportEntityById,
  loadVerifiedPassportsByVerifier,
} from "../lib/ponder-passport-entity";
import {
  attachPassportCustodyAnswer,
  resolvePassportCustodyAnswer,
  resolvePassportCustodyAnswersBatch,
} from "../lib/ponder-passport-custody";
import { normalizeProtocolAddressForVm } from "@/lib/web3/protocol-address";
import { ponderHttpCacheMiddleware } from "../lib/ponder-http-cache-middleware";

const app = new Hono();

/** Cache-Control / ETag owner — must register before any routes. */
app.use("*", ponderHttpCacheMiddleware);

registerCommerceRoutes(app);

function parsePage(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 20;
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
}

function parseAddressParam(raw: string): `0x${string}` | null {
  const trimmed = raw.trim();
  if (!isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

/** Optional chain id query param (e.g. custodyChain / verifier chain scope). */
function parseOptionalChainId(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function parseOffset(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseIdList(raw: string | undefined, max = 50): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
}

function jsonBody<T>(value: T): T {
  return replaceBigInts(value, (v) => String(v)) as T;
}

function parseProfileOwnerParam(raw: string): string | null {
  const trimmed = raw.trim();
  const evm = parseAddressParam(trimmed);
  if (evm) return evm;
  return normalizeProtocolAddressForVm("svm", trimmed);
}

app.get("/passports", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const owner = c.req.query("owner");
  const verifierParam = c.req.query("verifier");
  const status =
    c.req.query("status") ?? (verifierParam ? "VERIFIED" : undefined);
  const vin = c.req.query("vin")?.toUpperCase();
  const verifiedFirst = c.req.query("verifiedFirst") !== "false";
  const offset = (page - 1) * limit;

  if (owner) {
    const ownerAddress = parseAddressParam(owner);
    if (!ownerAddress) return c.json({ error: "Invalid owner" }, 400);
  }
  if (verifierParam) {
    try {
      getAddress(verifierParam);
    } catch {
      return c.json({ error: "Invalid verifier" }, 400);
    }
  }

  const { rows: passports, total } = await loadPassportEntitiesBrowse({
    owner: owner ? getAddress(owner) : undefined,
    status,
    vin,
    verifier: verifierParam ? getAddress(verifierParam) : undefined,
    verifiedFirst,
    limit,
    offset,
  });

  return c.json(
    jsonBody({
      passports,
      total,
      page,
      limit,
    }),
  );
});

app.get("/passports/batch", async (c) => {
  const ids = parseIdList(c.req.query("ids"));
  if (ids.length === 0) {
    return c.json(jsonBody({ passports: [] }));
  }

  const passports = await loadPassportEntitiesByIds(ids);

  return c.json(jsonBody({ passports }));
});

app.get("/notifications/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const sinceRaw = c.req.query("since") ?? "0";
  const since = BigInt(sinceRaw);
  const limit = parseLimit(c.req.query("limit"));

  const items = await buildNotificationFeed(db, address, since, limit);

  return c.json(
    jsonBody({
      items,
      since: String(since),
      limit,
    }),
  );
});

/**
 * Outstanding ClaimablePayouts balances for an account.
 * Unions passport/staking `pending_claim` with mode `commerce_claim` — one product reader.
 */
app.get("/accounts/:address/claims", async (c) => {
  const address = parseAddressParam(c.req.param("address"));
  if (!address) {
    return c.json({ error: "Invalid address" }, 400);
  }
  const chainId = parseOptionalChainId(c.req.query("chainId"));
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const offset = (page - 1) * limit;

  const legacyCond = [eq(pendingClaim.account, address), gt(pendingClaim.amount, 0n)];
  const commerceCond = [eq(commerceClaim.account, address), gt(commerceClaim.amount, 0n)];
  if (chainId !== undefined) {
    legacyCond.push(eq(pendingClaim.chainId, chainId));
    commerceCond.push(eq(commerceClaim.chainId, chainId));
  }

  const [legacyRows, commerceRows, legacyTotal, commerceTotal] = await Promise.all([
    db
      .select()
      .from(pendingClaim)
      .where(and(...legacyCond))
      .orderBy(desc(pendingClaim.updatedAt)),
    db
      .select()
      .from(commerceClaim)
      .where(and(...commerceCond))
      .orderBy(desc(commerceClaim.updatedAt)),
    db.select({ value: count() }).from(pendingClaim).where(and(...legacyCond)),
    db.select({ value: count() }).from(commerceClaim).where(and(...commerceCond)),
  ]);

  type BalanceRow = {
    id: string;
    chainId: number;
    contract: string;
    account: string;
    asset: string;
    amount: bigint;
    /** Present on legacy `pending_claim`; absent on `commerce_claim`. */
    reasonCode?: string;
    updatedAt: bigint;
    firstCreditedAt: bigint;
  };

  const merged: BalanceRow[] = [...legacyRows, ...commerceRows].sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.id < b.id ? 1 : -1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });

  const total =
    (legacyTotal[0]?.value ?? 0) + (commerceTotal[0]?.value ?? 0);
  const pageRows = merged.slice(offset, offset + limit);

  const balanceKeys = new Set(
    pageRows.map(
      (r) =>
        `${r.chainId}-${r.contract.toLowerCase()}-${r.account.toLowerCase()}-${r.asset.toLowerCase()}`,
    ),
  );

  const legacyCreditCond = [eq(claimCredit.account, address)];
  const commerceCreditCond = [eq(commerceClaimCredit.account, address)];
  if (chainId !== undefined) {
    legacyCreditCond.push(eq(claimCredit.chainId, chainId));
    commerceCreditCond.push(eq(commerceClaimCredit.chainId, chainId));
  }

  const creditRows =
    pageRows.length === 0
      ? []
      : (
          await Promise.all([
            db
              .select()
              .from(claimCredit)
              .where(and(...legacyCreditCond))
              .orderBy(asc(claimCredit.timestamp)),
            db
              .select()
              .from(commerceClaimCredit)
              .where(and(...commerceCreditCond))
              .orderBy(asc(commerceClaimCredit.timestamp)),
          ])
        ).flat();

  const creditsByBalance = new Map<
    string,
    { id: string; amount: bigint; reasonCode: string; timestamp: bigint }[]
  >();
  for (const credit of creditRows) {
    const key = `${credit.chainId}-${credit.contract.toLowerCase()}-${credit.account.toLowerCase()}-${credit.asset.toLowerCase()}`;
    if (!balanceKeys.has(key)) continue;
    const list = creditsByBalance.get(key) ?? [];
    list.push({
      id: credit.id,
      amount: credit.amount,
      reasonCode: credit.reasonCode,
      timestamp: credit.timestamp,
    });
    creditsByBalance.set(key, list);
  }

  for (const [, list] of creditsByBalance) {
    list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }

  const claims = pageRows.map((row) => {
    const key = `${row.chainId}-${row.contract.toLowerCase()}-${row.account.toLowerCase()}-${row.asset.toLowerCase()}`;
    return {
      ...row,
      credits: creditsByBalance.get(key) ?? [],
    };
  });

  return c.json(
    jsonBody({
      claims,
      total,
      page,
      limit,
    }),
  );
});

app.get("/passports/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  const row = await loadPassportEntityById(tokenId);

  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  const [records, uriHistory, custody] = await Promise.all([
    loadPassportRecordsByTokenId(tokenId),
    loadPassportUriHistoryByTokenId(tokenId),
    resolvePassportCustodyAnswer(tokenId),
  ]);

  return c.json(
    jsonBody(attachPassportCustodyAnswer({ ...row, records, uriHistory }, custody)),
  );
});

app.get("/profile/:address/passports", async (c) => {
  const address = parseProfileOwnerParam(c.req.param("address"));
  if (!address) return c.json({ error: "Invalid address" }, 400);
  const passports = await loadPassportEntitiesByOwner(address);

  const custodyByToken = await resolvePassportCustodyAnswersBatch(
    passports.map((p) => p.id),
  );

  const enriched = passports.map((p) =>
    attachPassportCustodyAnswer(p, custodyByToken.get(p.id) ?? {
      custodyChain: null,
      custodyUnresolved: "empty_history",
    }),
  );

  return c.json(jsonBody({ passports: enriched }));
});

app.get("/verifiers", async (c) => {
  const [rows, verificationRows] = await Promise.all([
    db
      .select()
      .from(verifier)
      .where(eq(verifier.active, true))
      .orderBy(desc(verifier.joinedAt)),
    countVerifiedPassportsByVerifier(),
  ]);

  const verificationCountByVerifier = new Map<string, number>();
  for (const row of verificationRows) {
    if (!row.verifier) continue;
    try {
      verificationCountByVerifier.set(getAddress(row.verifier), row.total);
    } catch {
      verificationCountByVerifier.set(row.verifier, row.total);
    }
  }

  const verifiers = rows.map((v) => ({
    ...v,
    verificationCount:
      verificationCountByVerifier.get(getAddress(v.address)) ?? 0,
  }));

  return c.json(jsonBody({ verifiers }));
});

function isValidSlugParam(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug)
  );
}

async function buildVerifierDetailResponse(id: string) {
  const row = await db
    .select()
    .from(verifier)
    .where(eq(verifier.id, id))
    .limit(1);

  if (!row[0]) return null;

  const v = row[0];
  const checksumVerifier = getAddress(v.address);
  const verificationRows = await countVerifiedPassportsByVerifier();
  const verificationCount =
    verificationRows.find(
      (r) => r.verifier.toLowerCase() === checksumVerifier.toLowerCase(),
    )?.total ?? 0;

  const verifiedPassports = await loadVerifiedPassportsByVerifier(checksumVerifier, {
    limit: 20,
    offset: 0,
  });

  return jsonBody({
    address: v.address,
    chainId: v.chainId,
    identity: {
      category: v.category,
      name: v.name,
      slug: v.slug,
      metadataURI: v.metadataURI,
      locationLabel: v.locationLabel,
      locationPlaceId: v.locationPlaceId,
      locationCountryCode: v.locationCountryCode,
    },
    stake: {
      asset: v.stakeAsset,
      amount: v.stakeAmount,
      active: v.active,
    },
    joinedAt: v.joinedAt,
    leftAt: v.leftAt,
    verificationFee: v.verificationFee,
    verificationCount,
    verifiedPassports,
  });
}

app.get("/verifiers/by-slug/:slug", async (c) => {
  const slug = c.req.param("slug");
  const chainIdFilter = parseOptionalChainId(c.req.query("chainId"));
  const conditions = [eq(verifier.slug, slug), eq(verifier.active, true)];
  if (chainIdFilter !== undefined) {
    conditions.push(eq(verifier.chainId, chainIdFilter));
  }
  const row = await db
    .select()
    .from(verifier)
    .where(and(...conditions))
    .limit(1);

  if (!row[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const detail = await buildVerifierDetailResponse(row[0].id);
  if (!detail) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(detail);
});

app.get("/verifiers/slug-available/:slug", async (c) => {
  const slug = c.req.param("slug");
  const ownerAddress = c.req.query("address")?.toLowerCase();
  const chainIdFilter = parseOptionalChainId(c.req.query("chainId"));

  if (!isValidSlugParam(slug)) {
    return c.json({ available: false, slug });
  }

  const conditions = [eq(verifier.slug, slug), eq(verifier.active, true)];
  if (chainIdFilter !== undefined) {
    conditions.push(eq(verifier.chainId, chainIdFilter));
  }

  const rows = await db
    .select()
    .from(verifier)
    .where(and(...conditions));

  const takenByOther = rows.some((row) => {
    if (!ownerAddress) return true;
    return row.address.toLowerCase() !== ownerAddress;
  });

  return c.json({ available: !takenByOther, slug });
});

app.get("/verifiers/:address", async (c) => {
  const address = parseAddressParam(c.req.param("address"));
  if (!address) {
    return c.json({ error: "Invalid address" }, 400);
  }
  const chainId = parseOptionalChainId(c.req.query("chainId"));
  let id: string;
  if (chainId !== undefined) {
    id = normalizeVerifierId(chainId, address);
  } else {
    // Prefer ?chainId= (SPEC §I.12.12). Fallback: first active row for address.
    // Case-insensitive: historical rows may be lowercase; writes store checksum.
    const rows = await db
      .select()
      .from(verifier)
      .where(sql`lower(${verifier.address}) = ${address.toLowerCase()}`)
      .orderBy(desc(verifier.active), desc(verifier.joinedAt))
      .limit(1);
    if (!rows[0]) {
      return c.json({ error: "Not found" }, 404);
    }
    id = rows[0].id;
  }
  const detail = await buildVerifierDetailResponse(id);

  if (!detail) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(detail);
});

app.get("/verifiers/:address/attestations", async (c) => {
  const id = c.req.param("address").toLowerCase();
  const limit = parseLimit(c.req.query("limit"));
  const offset = parseOffset(c.req.query("offset"));

  const [attestations, total] = await Promise.all([
    loadAttestationsByAuthor(id, { limit, offset }),
    countAttestationsByAuthor(id),
  ]);

  return c.json(
    jsonBody({
      attestations,
      total,
      limit,
      offset,
    }),
  );
});

export default app;
