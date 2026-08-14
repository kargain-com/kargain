import type { ReactNode } from "react";

import { IdentityProviders } from "@/components/providers/identity-providers";
import { SiteChrome } from "@/components/shell/site-chrome";

export default function IdentityLayout({ children }: { children: ReactNode }) {
  return (
    <IdentityProviders>
      <SiteChrome identityBadges>{children}</SiteChrome>
    </IdentityProviders>
  );
}
