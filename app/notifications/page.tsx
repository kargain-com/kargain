import type { Metadata } from "next";
import { Suspense } from "react";

import { NotificationsShell } from "@/components/notifications/notifications-shell";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 pt-8 md:pt-12 pb-16">
        <Suspense fallback={null}>
          <NotificationsShell />
        </Suspense>
      </div>
    </div>
  );
}
