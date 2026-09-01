/**
 * Shared loader for GET /accounts/:address/obligations and notification
 * approaching projection. Returns the facts bag for deriveOutstandingObligations.
 */

import { db } from "ponder:api";
import {
  challenge,
  commerceMode,
  consignment,
  consignmentBid,
  consignmentHold,
} from "ponder:schema";
import { and, eq, inArray } from "ponder";
import { getAddress } from "viem";

import type { ObligationFacts } from "../../lib/obligation/types";
import { LIVE_PHASES } from "../lib/ponder-commerce";
import { buildObligationFacts } from "../lib/ponder-obligations";
import {
  loadPassportEntitiesByIds,
  loadPassportEntitiesFiltered,
} from "../lib/ponder-passport-entity";

const LIVE_PHASE_LIST = [...LIVE_PHASES];
const ACTIVE_HOLD_STATES = ["active", "reversalStarted"] as const;

function withOptionalChain(
  chainId: number | undefined,
  ...conditions: Array<
    ReturnType<typeof eq> | ReturnType<typeof inArray> | undefined
  >
) {
  const list = conditions.filter(
    (x): x is NonNullable<typeof x> => x != null,
  );
  return list.length === 1 ? list[0]! : and(...list);
}

export async function loadObligationFacts(
  address: `0x${string}`,
  chainId?: number,
): Promise<ObligationFacts> {
  const checksum = getAddress(address);
  const lower = checksum.toLowerCase();

  try {
    const passportFilter = {
      statusExact: "DISPUTED" as const,
      ...(chainId !== undefined ? { chainId } : {}),
    };

    const [
      asSeller,
      asAgent,
      asBuyer,
      holdsAsBuyer,
      bidsAsBidder,
      challengesAsChallenger,
      openChallenges,
      ownedDisputed,
      verifiedDisputed,
      modes,
    ] = await Promise.all([
      db
        .select()
        .from(consignment)
        .where(
          withOptionalChain(
            chainId,
            eq(consignment.seller, checksum),
            inArray(consignment.phase, LIVE_PHASE_LIST),
            chainId !== undefined
              ? eq(consignment.chainId, chainId)
              : undefined,
          ),
        ),
      db
        .select()
        .from(consignment)
        .where(
          withOptionalChain(
            chainId,
            eq(consignment.agent, checksum),
            inArray(consignment.phase, LIVE_PHASE_LIST),
            chainId !== undefined
              ? eq(consignment.chainId, chainId)
              : undefined,
          ),
        ),
      db
        .select()
        .from(consignment)
        .where(
          withOptionalChain(
            chainId,
            eq(consignment.buyer, checksum),
            inArray(consignment.phase, LIVE_PHASE_LIST),
            chainId !== undefined
              ? eq(consignment.chainId, chainId)
              : undefined,
          ),
        ),
      db
        .select()
        .from(consignmentHold)
        .where(
          withOptionalChain(
            chainId,
            eq(consignmentHold.buyer, checksum),
            inArray(consignmentHold.state, [...ACTIVE_HOLD_STATES]),
            chainId !== undefined
              ? eq(consignmentHold.chainId, chainId)
              : undefined,
          ),
        ),
      db
        .select()
        .from(consignmentBid)
        .where(
          withOptionalChain(
            chainId,
            eq(consignmentBid.bidder, checksum),
            eq(consignmentBid.refunded, false),
            chainId !== undefined
              ? eq(consignmentBid.chainId, chainId)
              : undefined,
          ),
        ),
      db
        .select()
        .from(challenge)
        .where(
          withOptionalChain(
            chainId,
            eq(challenge.challenger, checksum),
            eq(challenge.status, "open"),
            chainId !== undefined
              ? eq(challenge.chainId, chainId)
              : undefined,
          ),
        ),
      db
        .select()
        .from(challenge)
        .where(
          withOptionalChain(
            chainId,
            eq(challenge.status, "open"),
            chainId !== undefined
              ? eq(challenge.chainId, chainId)
              : undefined,
          ),
        ),
      loadPassportEntitiesFiltered({
        owner: lower,
        ...passportFilter,
      }),
      loadPassportEntitiesFiltered({
        verifierExact: checksum,
        ...passportFilter,
      }),
      chainId !== undefined
        ? db
            .select()
            .from(commerceMode)
            .where(eq(commerceMode.chainId, chainId))
        : db.select().from(commerceMode),
    ]);

    const partyConsignmentIds = [
      ...new Set([...asSeller, ...asAgent, ...asBuyer].map((r) => r.id)),
    ];
    const holdsForParty =
      partyConsignmentIds.length > 0
        ? await db
            .select()
            .from(consignmentHold)
            .where(
              and(
                inArray(consignmentHold.consignmentId, partyConsignmentIds),
                inArray(consignmentHold.state, [...ACTIVE_HOLD_STATES]),
              ),
            )
        : [];

    const holdConsignmentIds = [
      ...new Set(
        [...holdsAsBuyer, ...holdsForParty].map((h) => h.consignmentId),
      ),
    ];
    const bidConsignmentIds = [
      ...new Set(bidsAsBidder.map((b) => b.consignmentId)),
    ];
    const missingIds = [
      ...new Set(
        [...holdConsignmentIds, ...bidConsignmentIds].filter(
          (id) => !partyConsignmentIds.includes(id),
        ),
      ),
    ];
    const extraConsignments =
      missingIds.length > 0
        ? await db
            .select()
            .from(consignment)
            .where(inArray(consignment.id, missingIds))
        : [];

    const ascendingSubjects = openChallenges
      .filter((ch) => ch.instance === "ascending")
      .map((ch) => ch.subjectId);
    const ascendingHolds =
      ascendingSubjects.length > 0
        ? await db
            .select()
            .from(consignmentHold)
            .where(
              withOptionalChain(
                chainId,
                inArray(consignmentHold.tokenId, ascendingSubjects),
                inArray(consignmentHold.state, [...ACTIVE_HOLD_STATES]),
                chainId !== undefined
                  ? eq(consignmentHold.chainId, chainId)
                  : undefined,
              ),
            )
        : [];
    const ascendingConsignmentIds = [
      ...new Set(ascendingHolds.map((h) => h.consignmentId)),
    ];
    const ascendingConsignments =
      ascendingConsignmentIds.length > 0
        ? await db
            .select()
            .from(consignment)
            .where(inArray(consignment.id, ascendingConsignmentIds))
        : [];

    const passportSubjects = openChallenges
      .filter((ch) => ch.instance === "passport")
      .map((ch) => ch.subjectId);
    const challengePassports =
      passportSubjects.length > 0
        ? await loadPassportEntitiesByIds(passportSubjects)
        : [];

    const holdMap = new Map<string, (typeof holdsAsBuyer)[number]>();
    for (const h of [...holdsAsBuyer, ...holdsForParty, ...ascendingHolds]) {
      holdMap.set(h.id, h);
    }

    const challengeMap = new Map<string, (typeof openChallenges)[number]>();
    for (const ch of [...challengesAsChallenger, ...openChallenges]) {
      challengeMap.set(ch.id, ch);
    }

    const passportMap = new Map<string, (typeof ownedDisputed)[number]>();
    for (const p of [
      ...ownedDisputed,
      ...verifiedDisputed,
      ...challengePassports,
    ]) {
      passportMap.set(p.id, p);
    }

    return buildObligationFacts({
      unresolved: false,
      consignments: [
        ...asSeller,
        ...asAgent,
        ...asBuyer,
        ...extraConsignments,
        ...ascendingConsignments,
      ],
      holds: [...holdMap.values()],
      bids: bidsAsBidder,
      challenges: [...challengeMap.values()],
      passports: [...passportMap.values()],
      modes,
    });
  } catch {
    return {
      unresolved: true,
      consignments: [],
      holds: [],
      bids: [],
      challenges: [],
      passports: [],
      modes: [],
    };
  }
}
