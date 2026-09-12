"use client";

/**
 * Dual-VM write-session refusal chrome (U6.1).
 * Consumes {@link txWriteRefusalTitle} — never derives VM in the screen.
 * Sibling of {@link EvmSessionRefusal}; do not reshape that surface.
 * Connect dialog action = sibling {@link WalletLoginButton} (design-spec §4.7).
 */

import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import {
  txWriteRefusalTitle,
  type TxWriteUnavailable,
} from "@/lib/web3/tx-write-availability";

type Props = {
  refusal: TxWriteUnavailable;
  /** Override title when a surface needs a more specific disconnected sentence. */
  disconnectedTitle?: string;
  className?: string;
};

export function TxWriteRefusal({
  refusal,
  disconnectedTitle,
  className,
}: Props) {
  const title = txWriteRefusalTitle(refusal, disconnectedTitle);
  return (
    <div className={className ?? "space-y-3"}>
      <EmptyState variant="infrastructure" level="B" title={title} />
      <WalletLoginButton />
    </div>
  );
}
