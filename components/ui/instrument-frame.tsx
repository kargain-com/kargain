/**
 * Corner-bracket registration frame (design-spec §12.4).
 * IL-2 will wrap passport-photo-gallery hero and VIN blocks.
 */
import type { ReactNode } from "react";

import {
  instrumentFrameCorner,
  instrumentFrameCornerVerified,
} from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  verified?: boolean;
  className?: string;
};

function Corner({
  verified,
  className,
}: {
  verified: boolean;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        verified ? instrumentFrameCornerVerified : instrumentFrameCorner,
        className,
      )}
    />
  );
}

export function InstrumentFrame({ children, verified = false, className }: Props) {
  return (
    <div className={cn("relative", className)}>
      <Corner verified={verified} className="left-0 top-0 border-l border-t" />
      <Corner verified={verified} className="right-0 top-0 border-r border-t" />
      <Corner verified={verified} className="bottom-0 left-0 border-b border-l" />
      <Corner verified={verified} className="bottom-0 right-0 border-b border-r" />
      {children}
    </div>
  );
}
