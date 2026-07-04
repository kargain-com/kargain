"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  useListingComments,
  type UseListingCommentsResult,
} from "@/hooks/use-listing-comments";

const ListingCommentsContext = createContext<UseListingCommentsResult | null>(null);

export function ListingCommentsProvider({
  tokenId,
  children,
}: {
  tokenId: string;
  children: ReactNode;
}) {
  const feed = useListingComments(tokenId);
  return (
    <ListingCommentsContext.Provider value={feed}>{children}</ListingCommentsContext.Provider>
  );
}

export function useListingCommentsContext(): UseListingCommentsResult {
  const ctx = useContext(ListingCommentsContext);
  if (!ctx) {
    throw new Error("useListingCommentsContext must be used within ListingCommentsProvider");
  }
  return ctx;
}

export function useListingCommentsContextOptional(): UseListingCommentsResult | null {
  return useContext(ListingCommentsContext);
}
