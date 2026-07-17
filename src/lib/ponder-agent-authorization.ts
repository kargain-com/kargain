import type { PonderFeedItem } from "../../lib/notifications/types";

export type AuthorizationNotificationType =
  | "agent.authorized"
  | "auction_agent.authorized";

export type AuthorizationNotificationRow = {
  tokenId: string;
  owner: string;
  agent: string;
  active: boolean;
  authorizedAt: bigint;
};

export function agentAuthorizationId(tokenId: string, agent: string): string {
  return `${tokenId}-${agent.toLowerCase()}`;
}

export function marketplaceAgentAuthorizedRow(params: {
  tokenId: string;
  owner: string;
  agent: string;
  expiry: bigint;
  ownerMinPrice1e8: bigint;
  timestamp: bigint;
}) {
  return {
    id: agentAuthorizationId(params.tokenId, params.agent),
    tokenId: params.tokenId,
    owner: params.owner,
    agent: params.agent,
    expiry: params.expiry,
    ownerMinPrice1e8: params.ownerMinPrice1e8,
    active: true,
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
    authorizedAt: params.timestamp,
  };
}

export function marketplaceAgentReauthorizedPatch(
  row: ReturnType<typeof marketplaceAgentAuthorizedRow>,
) {
  return {
    tokenId: row.tokenId,
    owner: row.owner,
    agent: row.agent,
    expiry: row.expiry,
    ownerMinPrice1e8: row.ownerMinPrice1e8,
    active: true,
    updatedAt: row.updatedAt,
    authorizedAt: row.authorizedAt,
  };
}

export function authorizationDeactivatedPatch(updatedAt: bigint) {
  return {
    active: false,
    updatedAt,
  };
}

export function authorizationTermsUpdatedPatch(
  ownerMinPrice1e8: bigint,
  updatedAt: bigint,
) {
  return {
    ownerMinPrice1e8,
    updatedAt,
  };
}

export function authorizationNotificationItems(
  rows: AuthorizationNotificationRow[],
  type: AuthorizationNotificationType,
  recipient: string,
  since: bigint,
): PonderFeedItem[] {
  return rows
    .filter(
      (row) =>
        row.agent === recipient &&
        row.active &&
        row.authorizedAt > since,
    )
    .map((row) => ({
      id: `${type}:${row.tokenId}:${row.authorizedAt}`,
      type,
      tokenId: row.tokenId,
      timestamp: String(row.authorizedAt),
      actor: row.owner,
    }));
}
