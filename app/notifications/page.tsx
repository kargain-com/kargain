import type { Metadata } from "next";
import { Suspense } from "react";

import { NotificationsShell } from "@/components/notifications/notifications-shell";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
      <Suspense fallback={null}>
        <NotificationsShell />
      </Suspense>
    </div>
  );
}
