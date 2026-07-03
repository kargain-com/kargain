"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { usePassportPanelUrl } from "@/components/passport/passport-detail-panel-chrome";
import { useMediaMd } from "@/hooks/use-media-md";
import type { PassportPanel } from "@/lib/passport/passport-panel-url";
import { cn } from "@/lib/utils";

const PANEL_SECTION_ID: Record<PassportPanel, string> = {
  actions: "passport-actions",
  comments: "passport-comments",
};

type Props = {
  panel: PassportPanel;
  children: ReactNode;
  className?: string;
};

export function PassportPanelLink({ panel, children, className }: Props) {
  const { isMd } = useMediaMd();
  const { openPanel } = usePassportPanelUrl();

  if (isMd) {
    return (
      <Link href={`#${PANEL_SECTION_ID[panel]}`} className={cn("link-underline", className)}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={cn("link-underline", className)}
      onClick={() => openPanel(panel)}
    >
      {children}
    </button>
  );
}
