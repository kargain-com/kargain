import Link from "next/link";
import type { ReactNode } from "react";

import {
  monoLink,
  monoLinkSm,
  sansLink,
  sansLinkUnderline,
} from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

export type InstrumentLinkVariant = "mono" | "monoSm" | "sans" | "sansUnderline";

const variantClass: Record<InstrumentLinkVariant, string> = {
  mono: monoLink,
  monoSm: monoLinkSm,
  sans: sansLink,
  sansUnderline: sansLinkUnderline,
};

type Props = {
  href: string;
  children: ReactNode;
  variant?: InstrumentLinkVariant;
  external?: boolean;
  className?: string;
};

export function InstrumentLink({
  href,
  children,
  variant = "mono",
  external = false,
  className,
}: Props) {
  const linkClassName = cn(variantClass[variant], className);

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={linkClassName}>
      {children}
    </Link>
  );
}
