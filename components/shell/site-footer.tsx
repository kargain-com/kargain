import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { KargainLogo } from "@/components/ui/kargain-logo";

const linkClassName =
  "font-sans text-sm text-text-secondary transition-colors hover:text-text-primary";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="border-t border-border-default bg-bg-primary pb-20 md:pb-0"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-7xl px-6 py-6 md:px-8 xl:max-w-[80rem]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <KargainLogo size={24} />
            <span className="font-sans text-sm font-medium text-text-primary">Kargain</span>
            <span className="font-mono text-xs text-text-tertiary" aria-hidden>
              ·
            </span>
            <span className="font-mono text-xs text-text-tertiary">MIT License</span>
          </div>

          <nav
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
            aria-label="Footer"
          >
            <Link href="/about" className={linkClassName}>
              About
            </Link>
            <Link href="/terms" className={linkClassName}>
              Terms
            </Link>
            <Link href="/privacy" className={linkClassName}>
              Privacy
            </Link>
            <a
              href="https://github.com/kargain-com/kargain"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              GitHub
              <ExternalLink size={12} strokeWidth={1.5} className="ml-1 inline" aria-hidden />
            </a>
          </nav>
        </div>

        <p className="mt-4 text-center font-mono text-xs text-text-tertiary">
          © {year} Kargain · Decentralized marketplace for used vehicles
        </p>
      </div>
    </footer>
  );
}
