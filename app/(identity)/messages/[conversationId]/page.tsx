"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";

import { ConversationThreadClient } from "@/components/messaging/conversation-thread-client";
import { useClientMounted } from "@/hooks/use-client-mounted";

export default function ConversationPage() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <Suspense
        fallback={
          <p className="p-8 text-center text-sm text-text-secondary" role="status">
            Loading conversation…
          </p>
        }
      >
        <ConversationBody />
      </Suspense>
    </div>
  );
}

function ConversationBody() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const mounted = useClientMounted();
  const params = useParams();
  const conversationId = typeof params.conversationId === "string" ? params.conversationId : "";

  useEffect(() => {
    if (!mounted) return;
    if (!isConnected) router.replace("/messages");
  }, [mounted, isConnected, router]);

  if (!mounted || !isConnected) {
    return <div className="min-h-[50vh] bg-bg-primary" aria-busy="true" />;
  }

  if (!conversationId) {
    return <p className="p-8 text-center text-sm text-text-secondary">Invalid conversation.</p>;
  }

  return <ConversationThreadClient conversationId={conversationId} />;
}
