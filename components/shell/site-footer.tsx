import Link from "next/link";

export function SiteFooter() {
  return (
    <footer
      className="border-t border-border-default bg-bg-primary pb-20 text-text-secondary md:pb-0"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-16 md:px-8 xl:max-w-[80rem]">
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Footer">
          <Link href="/about" className="hover:text-text-primary">
            About
          </Link>
          <Link href="/terms" className="hover:text-text-primary">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-text-primary">
            Privacy
          </Link>
        </nav>
        <p className="text-center text-xs text-text-secondary">© {new Date().getFullYear()} Kargain · Urban mobility for the next generation</p>
      </div>
    </footer>
  );
}
