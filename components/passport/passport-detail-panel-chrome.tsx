"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import NostrCommentsSection from "@/components/marketplace/nostr-comments-section";
import { PassportActionsPanel } from "@/components/passport/passport-actions-panel";
import { PassportPanelSheet } from "@/components/passport/passport-panel-sheet";
import { PassportRecordsTimeline } from "@/components/passport/passport-records-timeline";
import { PassportUriHistory } from "@/components/passport/passport-uri-history";
import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { useMediaMd } from "@/hooks/use-media-md";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import type { PassportTopComment } from "@/lib/passport/passport-comment-summary";
import {
  buildPassportPanelQuery,
  parsePassportPanel,
  type PassportPanel,
} from "@/lib/passport/passport-panel-url";
import type {
  PonderPassportRecord,
  PonderUriHistoryEntry,
} from "@/lib/types/ponder";

type OpenPanelOptions = {
  replace?: boolean;
};

type PanelChromeContextValue = {
  panel: PassportPanel | null;
  openPanel: (panel: PassportPanel, options?: OpenPanelOptions) => void;
  closePanel: () => void;
  commentCount: number | null;
  topComment: PassportTopComment | null;
  setCommentCount: (count: number | null) => void;
  setTopComment: (comment: PassportTopComment | null) => void;
};

const PanelChromeContext = createContext<PanelChromeContextValue | null>(null);

const PANEL_SECTION_ID: Record<PassportPanel, string> = {
  records: "passport-records",
  actions: "passport-actions",
  comments: "passport-comments",
};

export function usePassportPanelUrl() {
  const ctx = useContext(PanelChromeContext);
  if (!ctx) {
    throw new Error("usePassportPanelUrl must be used within PassportDetailPanelChrome");
  }
  return ctx;
}

export function usePassportQuickNavOptional(): Pick<
  PanelChromeContextValue,
  "setCommentCount" | "setTopComment"
> | null {
  const ctx = useContext(PanelChromeContext);
  if (!ctx) return null;
  return { setCommentCount: ctx.setCommentCount, setTopComment: ctx.setTopComment };
}

export function usePassportCommentSummaryOptional(): Pick<
  PanelChromeContextValue,
  "commentCount" | "topComment"
> | null {
  const ctx = useContext(PanelChromeContext);
  if (!ctx) return null;
  return { commentCount: ctx.commentCount, topComment: ctx.topComment };
}

function panelUrl(
  pathname: string,
  searchParams: URLSearchParams,
  panel: PassportPanel | null,
): string {
  const next = buildPassportPanelQuery(panel, new URLSearchParams(searchParams.toString()));
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

type ChromeProps = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  duplicateVin?: boolean;
  records: PonderPassportRecord[];
  lastDisputer: string;
  disputeReason: string;
  disputeWithdrawnAt: string;
  tokenUri: string;
  currentMetadata: PassportMetadata | null;
  uriHistory: PonderUriHistoryEntry[];
  verificationResetCount: number;
  lastVerificationResetAt: string;
  listingActive?: boolean;
  listingSeller?: `0x${string}`;
  children: ReactNode;
};

export function PassportDetailPanelChrome({
  status,
  passportOwner,
  chainId,
  tokenId,
  duplicateVin = false,
  records,
  lastDisputer,
  disputeReason,
  disputeWithdrawnAt,
  tokenUri,
  currentMetadata,
  uriHistory,
  verificationResetCount,
  lastVerificationResetAt,
  listingActive,
  listingSeller,
  children,
}: ChromeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isMd } = useMediaMd();
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [topComment, setTopComment] = useState<PassportTopComment | null>(null);
  const [actionsDirty, setActionsDirty] = useState(false);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const autoOpenedEventRef = useRef(false);
  const panelHistoryPushedRef = useRef(false);
  const desktopCommentsHandledRef = useRef<string | null>(null);

  const panel = parsePassportPanel(searchParams.get("panel"));

  const openPanel = useCallback(
    (nextPanel: PassportPanel, options?: OpenPanelOptions) => {
      // Desktop: comments live in the right rail — scroll instead of sheet.
      if (isMd && nextPanel === "comments") {
        document.getElementById(PANEL_SECTION_ID.comments)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        const url = panelUrl(pathname, new URLSearchParams(searchParams.toString()), null);
        router.replace(url, { scroll: false });
        return;
      }

      const current = parsePassportPanel(searchParams.get("panel"));
      if (current === nextPanel && !options?.replace) return;

      const url = panelUrl(pathname, new URLSearchParams(searchParams.toString()), nextPanel);
      if (options?.replace) {
        router.replace(url, { scroll: false });
        return;
      }
      panelHistoryPushedRef.current = true;
      router.push(url, { scroll: false });
    },
    [isMd, pathname, router, searchParams],
  );

  const closePanel = useCallback(() => {
    if (panelHistoryPushedRef.current) {
      panelHistoryPushedRef.current = false;
      router.back();
      return;
    }
    const url = panelUrl(pathname, new URLSearchParams(searchParams.toString()), null);
    router.replace(url, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (panel == null) {
      panelHistoryPushedRef.current = false;
    }
  }, [panel]);

  // Mobile: deep link `?e=` opens comments sheet.
  useEffect(() => {
    if (isMd) return;
    const eventId = searchParams.get("e");
    if (!eventId || autoOpenedEventRef.current) return;
    autoOpenedEventRef.current = true;
    if (panel !== "comments") {
      openPanel("comments", { replace: true });
    }
  }, [isMd, openPanel, panel, searchParams]);

  // Desktop: `?panel=comments` or `?e=` scrolls to right-rail discussion, then clears panel.
  useEffect(() => {
    if (!isMd) return;
    const eventId = searchParams.get("e");
    const wantsComments = panel === "comments" || Boolean(eventId);
    if (!wantsComments) return;

    const key = `${panel ?? ""}:${eventId ?? ""}`;
    if (desktopCommentsHandledRef.current === key) return;
    desktopCommentsHandledRef.current = key;

    requestAnimationFrame(() => {
      const targetId = eventId ? `comment-${eventId}` : PANEL_SECTION_ID.comments;
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: eventId ? "center" : "start",
      });
    });

    // Preserve `e` while scrolling; strip panel only.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [isMd, panel, pathname, router, searchParams]);

  const contextValue = useMemo(
    () => ({
      panel,
      openPanel,
      closePanel,
      commentCount,
      topComment,
      setCommentCount,
      setTopComment,
    }),
    [panel, openPanel, closePanel, commentCount, topComment],
  );

  const commentsSheetOpen = !isMd && panel === "comments";
  const discussionTitle =
    commentCount != null && commentCount > 0
      ? `Discussion · ${commentCount}`
      : "Discussion";

  return (
    <PanelChromeContext.Provider value={contextValue}>
      {children}

      <PassportPanelSheet
        open={panel === "records"}
        title="History & records"
        sectionId={PANEL_SECTION_ID.records}
        onOpen={() => openPanel("records")}
        onClose={closePanel}
      >
        <div className="space-y-6">
          <PassportRecordsTimeline
            records={records}
            passportOwner={passportOwner}
            lastDisputer={lastDisputer}
            disputeReason={disputeReason}
          />
          <PassportUriHistory entries={uriHistory} chainId={chainId} />
        </div>
      </PassportPanelSheet>

      <PassportPanelSheet
        open={panel === "actions"}
        title="Actions"
        sectionId={PANEL_SECTION_ID.actions}
        dirty={actionsDirty}
        busy={actionsBusy}
        onOpen={() => openPanel("actions")}
        onClose={closePanel}
      >
        <PassportActionsPanel
          tokenId={tokenId}
          chainId={chainId}
          passportOwner={passportOwner}
          status={status}
          lastDisputer={lastDisputer}
          disputeWithdrawnAt={disputeWithdrawnAt}
          duplicateVin={duplicateVin}
          listingActive={listingActive}
          listingSeller={listingSeller}
          tokenUri={tokenUri}
          currentMetadata={currentMetadata}
          uriHistory={uriHistory}
          verificationResetCount={verificationResetCount}
          lastVerificationResetAt={lastVerificationResetAt}
          embeddedInSheet
          onDirtyChange={setActionsDirty}
          onBusyChange={setActionsBusy}
        />
      </PassportPanelSheet>

      {/* Mobile-only discussion sheet; desktop uses PassportDiscussionRail. */}
      {!isMd && (
        <PassportPanelSheet
          open={commentsSheetOpen}
          title={discussionTitle}
          sectionId={PANEL_SECTION_ID.comments}
          dirty={commentsDirty}
          busy={commentsBusy}
          onOpen={() => openPanel("comments")}
          onClose={closePanel}
        >
          <NostrCommentsSection
            tokenId={tokenId}
            embeddedInSheet
            onDirtyChange={setCommentsDirty}
            onBusyChange={setCommentsBusy}
          />
        </PassportPanelSheet>
      )}
    </PanelChromeContext.Provider>
  );
}
