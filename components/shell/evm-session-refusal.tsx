"use client";

/**
 * Named EVM-session refusal chrome (S8-5).
 * Consumes {@link evmSessionRefusalCopy} — never derives VM in the screen.
 * Connect dialog action = sibling {@link WalletLoginButton} (design-spec §4.7).
 */

import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import {
  evmSessionRefusalCopy,
  type EvmSessionCause,
} from "@/hooks/use-active-account";

type Props = {
  cause: EvmSessionCause;
  /** Override title when a surface needs a more specific disconnected sentence. */
  disconnectedTitle?: string;
  className?: string;
};

export function EvmSessionRefusal({
  cause,
  disconnectedTitle,
  className,
}: Props) {
  const title =
    cause === "disconnected" && disconnectedTitle
      ? disconnectedTitle
      : evmSessionRefusalCopy(cause);
  return (
    <div className={className ?? "space-y-3"}>
      <EmptyState variant="infrastructure" level="B" title={title} />
      <WalletLoginButton />
    </div>
  );
}
