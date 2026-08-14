import type { ReactNode } from "react";

import { SiteChrome } from "@/components/shell/site-chrome";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <SiteChrome identityBadges={false}>{children}</SiteChrome>;
}
