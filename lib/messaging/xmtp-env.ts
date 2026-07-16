export type MessagingXmtpEnv = "local" | "dev" | "production";

export function getMessagingXmtpEnv(): MessagingXmtpEnv {
  const raw = process.env.NEXT_PUBLIC_XMTP_ENV?.trim();
  if (raw === "local" || raw === "dev" || raw === "production") {
    return raw;
  }
  return "production";
}
