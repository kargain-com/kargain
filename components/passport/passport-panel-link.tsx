"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  buildPassportTabQuery,
  type PassportTab,
} from "@/lib/passport/passport-tab-url";
import { cn } from "@/lib/utils";

type Props = {
  /** Maps legacy panel ids to tabs; `comments` scrolls to discussion. */
  panel: "records" | "actions" | "comments";
  children: ReactNode;
  className?: string;
};

const PANEL_TO_TAB: Record<"records" | "actions", PassportTab> = {
  records: "records",
  actions: "actions",
};

export function PassportPanelLink({ panel, children, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <button
      type="button"
      className={cn("link-underline", className)}
      onClick={() => {
        if (panel === "comments") {
          document.getElementById("passport-comments")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          return;
        }
        const next = buildPassportTabQuery(
          PANEL_TO_TAB[panel],
          new URLSearchParams(searchParams.toString()),
        );
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      {children}
    </button>
  );
}
