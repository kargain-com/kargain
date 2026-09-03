"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { ConversationThreadClient } from "@/components/messaging/conversation-thread-client";
import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useClientMounted } from "@/hooks/use-client-mounted";
import {
  isSvmMessagingRefusal,
  SVM_MESSAGING_UNAVAILABLE,
} from "@/lib/messaging/snapshot-ui";

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
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const mounted = useClientMounted();
  const params = useParams();
  const conversationId = typeof params.conversationId === "string" ? params.conversationId : "";

  if (!mounted) {
    return <div className="min-h-[50vh] bg-bg-primary" aria-busy="true" />;
  }

  if (!evm.ok) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col justify-center gap-4 px-4 py-16 text-center">
        {isSvmMessagingRefusal(evm.cause) ? (
          <div className="space-y-3">
            <EmptyState
              variant="infrastructure"
              level="B"
              title={SVM_MESSAGING_UNAVAILABLE}
            />
            <WalletLoginButton />
          </div>
        ) : (
          <EvmSessionRefusal
            cause={evm.cause}
            disconnectedTitle="Connect your wallet to view your messages."
          />
        )}
      </div>
    );
  }

  if (!conversationId) {
    return <p className="p-8 text-center text-sm text-text-secondary">Invalid conversation.</p>;
  }

  return <ConversationThreadClient conversationId={conversationId} />;
}
