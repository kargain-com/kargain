"use client";

import type { ReactNode } from "react";

import { usePassportPanelUrl } from "@/components/passport/passport-detail-panel-chrome";
import type { PassportPanel } from "@/lib/passport/passport-panel-url";
import { cn } from "@/lib/utils";

type Props = {
  panel: PassportPanel;
  children: ReactNode;
  className?: string;
};

export function PassportPanelLink({ panel, children, className }: Props) {
  const { openPanel } = usePassportPanelUrl();

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
