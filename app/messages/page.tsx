import { MessageInboxClient } from "@/components/messaging/message-inbox-client";

export default function MessagesPage() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <MessageInboxClient />
    </div>
  );
}
