import { Suspense } from "react";

import { MessageInboxClient } from "@/components/messaging/message-inbox-client";

export default function MessagesPage() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <Suspense
        fallback={
          <p className="p-8 text-center text-sm text-text-secondary" role="status">
            Loading messages…
          </p>
        }
      >
        <MessageInboxClient />
      </Suspense>
    </div>
  );
}
