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

import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import NostrCommentsSection from "@/components/marketplace/nostr-comments-section";
import { PassportActionBar } from "@/components/passport/passport-action-bar";
import { PassportActionsPanel } from "@/components/passport/passport-actions-panel";
import { PassportRecordsTimeline } from "@/components/passport/passport-records-timeline";
import { PassportUriHistory } from "@/components/passport/passport-uri-history";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { sectionScrollAnchor } from "@/lib/design/instrument-classes";
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
import { cn } from "@/lib/utils";

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
  commerce: "passport-commerce",
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

function requestClosePassportPanel({
  busy,
  dirty,
  onClose,
}: {
  busy: boolean;
  dirty: boolean;
  onClose: () => void;
}) {
  if (busy) return;
  if (dirty && !window.confirm("Discard unsaved changes?")) return;
  onClose();
}

type ListingProp = {
  active: boolean;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
  agent?: string;
  returnRequestedAt?: string | number;
  externalPaymentConfirmedAt?: string | number;
} | null;

type ChromeProps = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  listing?: ListingProp;
  duplicateVin?: boolean;
  hadDispute?: boolean;
  records: PonderPassportRecord[];
  lastDisputer: string;
  disputeReason: string;
  disputeWithdrawnAt: string;
  tokenUri: string;
  currentMetadata: PassportMetadata | null;
  uriHistory: PonderUriHistoryEntry[];
  verificationResetCount: number;
  lastVerificationResetAt: string;
  children: ReactNode;
};

export function PassportDetailPanelChrome({
  status,
  passportOwner,
  chainId,
  tokenId,
  listing = null,
  duplicateVin = false,
  hadDispute = false,
  records,
  lastDisputer,
  disputeReason,
  disputeWithdrawnAt,
  tokenUri,
  currentMetadata,
  uriHistory,
  verificationResetCount,
  lastVerificationResetAt,
  children,
}: ChromeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [topComment, setTopComment] = useState<PassportTopComment | null>(null);
  const [actionsDirty, setActionsDirty] = useState(false);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const autoOpenedEventRef = useRef(false);
  const panelHistoryPushedRef = useRef(false);

  const panel = parsePassportPanel(searchParams.get("panel"));

  const openPanel = useCallback(
    (nextPanel: PassportPanel, options?: OpenPanelOptions) => {
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
    [pathname, router, searchParams],
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

  useEffect(() => {
    const eventId = searchParams.get("e");
    if (!eventId || autoOpenedEventRef.current) return;
    autoOpenedEventRef.current = true;
    if (panel !== "comments") {
      openPanel("comments", { replace: true });
    }
  }, [openPanel, panel, searchParams]);

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

  const listingPrice = listing
    ? {
        active: listing.active,
        fiatPrice1e8: listing.fiatPrice1e8,
        fiatCurrency: listing.fiatCurrency,
      }
    : null;

  return (
    <PanelChromeContext.Provider value={contextValue}>
      <PassportActionBar
        status={status}
        passportOwner={passportOwner}
        chainId={chainId}
        tokenId={tokenId}
        listing={listingPrice}
        commentCount={commentCount}
        panelOpen={panel != null}
        onOpenPanel={(nextPanel) => openPanel(nextPanel)}
      />
      {children}

      <PassportPanelSheet
        panelId="records"
        title="Records"
        sectionId={PANEL_SECTION_ID.records}
        open={panel === "records"}
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
        panelId="commerce"
        title="Buy"
        sectionId={PANEL_SECTION_ID.commerce}
        open={panel === "commerce"}
        onOpen={() => openPanel("commerce")}
        onClose={closePanel}
      >
        <div className="space-y-4">
          <WatchlistButton tokenId={tokenId} />
          <ListingDetailClientIsland
            chainId={chainId}
            tokenId={tokenId}
            listing={listing}
            passportOwner={passportOwner}
            passportStatus={status}
            duplicateVin={duplicateVin}
            hadDispute={hadDispute}
          />
        </div>
      </PassportPanelSheet>

      <PassportPanelSheet
        panelId="actions"
        title="Actions"
        sectionId={PANEL_SECTION_ID.actions}
        open={panel === "actions"}
        onOpen={() => openPanel("actions")}
        onClose={closePanel}
        dirty={actionsDirty}
        busy={actionsBusy}
      >
        <PassportActionsPanel
          tokenId={tokenId}
          chainId={chainId}
          passportOwner={passportOwner}
          status={status}
          lastDisputer={lastDisputer}
          disputeWithdrawnAt={disputeWithdrawnAt}
          duplicateVin={duplicateVin}
          listingActive={listing?.active}
          listingSeller={listing?.seller}
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

      <PassportPanelSheet
        panelId="comments"
        title="Discussion"
        sectionId={PANEL_SECTION_ID.comments}
        open={panel === "comments"}
        onOpen={() => openPanel("comments")}
        onClose={closePanel}
        dirty={commentsDirty}
        busy={commentsBusy}
      >
        <NostrCommentsSection
          tokenId={tokenId}
          embeddedInSheet
          onDirtyChange={setCommentsDirty}
          onBusyChange={setCommentsBusy}
        />
      </PassportPanelSheet>
    </PanelChromeContext.Provider>
  );
}

type PassportPanelSheetProps = {
  panelId: PassportPanel;
  title: string;
  sectionId: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  dirty?: boolean;
  busy?: boolean;
  children: ReactNode;
};

function PassportPanelSheet({
  panelId,
  title,
  sectionId,
  open,
  onOpen,
  onClose,
  dirty = false,
  busy = false,
  children,
}: PassportPanelSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpen();
          return;
        }
        requestClosePassportPanel({
          busy,
          dirty,
          onClose,
        });
      }}
    >
      <SheetContent
        side="bottom"
        forceMount
        className={cn("z-[60] max-h-[90dvh] gap-0 p-0")}
      >
        <SheetHeader className="shrink-0 px-4 pt-4">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div
          id={sectionId}
          className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-6", sectionScrollAnchor)}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
