import type { ReactNode } from "react";
import { Suspense } from "react";

import { ClaimsPendingBanner } from "@/components/claims/claims-pending-banner";
import { AppTopNav } from "@/components/shell/app-top-nav";
import { MobileBottomNav } from "@/components/shell/mobile-bottom-nav";
import { SiteFooter } from "@/components/shell/site-footer";

function NavFallback() {
  return <div className="h-14 border-b border-border-default bg-bg-primary" aria-hidden />;
}

export type SiteChromeProps = {
  children: ReactNode;
  /**
   * When true, Messages/Alerts show live unread/setup badges (identity routes
   * with Nostr + messaging providers). Public routes pass false.
   */
  identityBadges?: boolean;
};

/** Server shell — client leaves only for nav/banner; footer stays server. */
export function SiteChrome({
  children,
  identityBadges = false,
}: SiteChromeProps) {
  return (
    <>
      <Suspense fallback={<NavFallback />}>
        <AppTopNav identityBadges={identityBadges} />
      </Suspense>
      <Suspense fallback={null}>
        <ClaimsPendingBanner />
      </Suspense>
      <Suspense
        fallback={
          <div className="min-h-dvh pb-16 md:pb-0" role="status">
            <p className="px-4 py-8 text-center text-sm text-text-secondary">Loading…</p>
          </div>
        }
      >
        <div className="min-h-dvh pb-16 md:pb-0">
          {children}
          <SiteFooter />
        </div>
      </Suspense>
      <Suspense fallback={null}>
        <MobileBottomNav identityBadges={identityBadges} />
      </Suspense>
    </>
  );
}
