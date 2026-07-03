"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import NostrCommentsSection from "@/components/marketplace/nostr-comments-section";
import { PassportActionsPanel } from "@/components/passport/passport-actions-panel";
import { PassportQuickNav } from "@/components/passport/passport-quick-nav";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaMd } from "@/hooks/use-media-md";
import { sectionScrollAnchor } from "@/lib/design/instrument-classes";
import {
  buildPassportPanelQuery,
  parsePassportPanel,
  type PassportPanel,
} from "@/lib/passport/passport-panel-url";
import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { cn } from "@/lib/utils";

type OpenPanelOptions = {
  replace?: boolean;
};

type PanelChromeContextValue = {
  panel: PassportPanel | null;
  openPanel: (panel: PassportPanel, options?: OpenPanelOptions) => void;
  closePanel: () => void;
  setCommentCount: (count: number | null) => void;
};

const PanelChromeContext = createContext<PanelChromeContextValue | null>(null);

const PANEL_SECTION_ID: Record<PassportPanel, string> = {
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

export function usePassportQuickNavOptional(): Pick<PanelChromeContextValue, "setCommentCount"> | null {
  const ctx = useContext(PanelChromeContext);
  if (!ctx) return null;
  return { setCommentCount: ctx.setCommentCount };
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

type ChromeProps = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  children: ReactNode;
};

export function PassportDetailPanelChrome({
  status,
  passportOwner,
  chainId,
  tokenId,
  children,
}: ChromeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isMd } = useMediaMd();
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const autoOpenedEventRef = useRef(false);
  const panelHistoryPushedRef = useRef(false);
  const desktopPanelHandledRef = useRef<string | null>(null);

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
    if (isMd) return;
    const eventId = searchParams.get("e");
    if (!eventId || autoOpenedEventRef.current) return;
    autoOpenedEventRef.current = true;
    if (panel !== "comments") {
      openPanel("comments", { replace: true });
    }
  }, [isMd, openPanel, panel, searchParams]);

  useEffect(() => {
    if (!isMd || !panel) return;
    const key = `${panel}:${searchParams.get("e") ?? ""}`;
    if (desktopPanelHandledRef.current === key) return;
    desktopPanelHandledRef.current = key;

    const sectionId = PANEL_SECTION_ID[panel];
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const url = panelUrl(pathname, new URLSearchParams(searchParams.toString()), null);
    router.replace(url, { scroll: false });
  }, [isMd, panel, pathname, router, searchParams]);

  const contextValue = useMemo(
    () => ({ panel, openPanel, closePanel, setCommentCount }),
    [panel, openPanel, closePanel],
  );

  const hideQuickNav = !isMd && panel != null;

  return (
    <PanelChromeContext.Provider value={contextValue}>
      {!hideQuickNav && (
        <PassportQuickNav
          status={status}
          passportOwner={passportOwner}
          chainId={chainId}
          tokenId={tokenId}
          commentCount={commentCount}
          onOpenPanel={(nextPanel) => openPanel(nextPanel)}
        />
      )}
      {children}
    </PanelChromeContext.Provider>
  );
}

type PassportPanelSheetProps = {
  panelId: PassportPanel;
  title: string;
  sectionId: string;
  dirty: boolean;
  busy: boolean;
  children: ReactNode;
};

function PassportPanelSheet({
  panelId,
  title,
  sectionId,
  dirty,
  busy,
  children,
}: PassportPanelSheetProps) {
  const { panel, openPanel, closePanel } = usePassportPanelUrl();

  return (
    <Sheet
      open={panel === panelId}
      onOpenChange={(open) => {
        if (open) {
          if (panel !== panelId) {
            openPanel(panelId);
          }
          return;
        }
        requestClosePassportPanel({
          busy,
          dirty,
          onClose: closePanel,
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

export function PassportActionsSlot(props: ComponentProps<typeof PassportActionsPanel>) {
  const { isMd } = useMediaMd();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isMd) {
    return (
      <div id="passport-actions" className={sectionScrollAnchor}>
        <PassportActionsPanel
          {...props}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
        />
      </div>
    );
  }

  return (
    <PassportPanelSheet
      panelId="actions"
      title="Actions"
      sectionId="passport-actions"
      dirty={dirty}
      busy={busy}
    >
      <PassportActionsPanel
        {...props}
        embeddedInSheet
        onDirtyChange={setDirty}
        onBusyChange={setBusy}
      />
    </PassportPanelSheet>
  );
}

export function PassportCommentsSlot({ tokenId }: { tokenId: string }) {
  const { isMd } = useMediaMd();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isMd) {
    return (
      <div id="passport-comments" className={sectionScrollAnchor}>
        <NostrCommentsSection
          tokenId={tokenId}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
        />
      </div>
    );
  }

  return (
    <PassportPanelSheet
      panelId="comments"
      title="Discussion"
      sectionId="passport-comments"
      dirty={dirty}
      busy={busy}
    >
      <NostrCommentsSection
        tokenId={tokenId}
        embeddedInSheet
        onDirtyChange={setDirty}
        onBusyChange={setBusy}
      />
    </PassportPanelSheet>
  );
}
