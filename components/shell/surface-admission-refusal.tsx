"use client";

/**
 * Sole chrome for {@link SurfaceAdmissionRefusal}.
 * Consumes {@link surfaceAdmissionRefusalCopy} — never derives sentences in the screen.
 * Connect dialog = sibling {@link WalletLoginButton} when §4.7 requires it
 * (disconnected / family_required / wrong_family).
 */

import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import {
  surfaceAdmissionRefusalCopy,
  type SurfaceAdmissionRefusal,
} from "@/lib/web3/surface-admission";

type Props = {
  refusal: SurfaceAdmissionRefusal;
  /** Override title when a surface needs a more specific disconnected sentence (§4.7). */
  disconnectedTitle?: string;
  /** Extra description (e.g. create-passport where-available line). */
  description?: string;
  className?: string;
  /** EmptyState level — default B. */
  level?: "A" | "B";
  variant?: "content" | "infrastructure";
};

function showsConnectAction(refusal: SurfaceAdmissionRefusal): boolean {
  return (
    refusal.status === "disconnected" ||
    refusal.status === "family_required" ||
    refusal.status === "wrong_family"
  );
}

export function SurfaceAdmissionRefusalView({
  refusal,
  disconnectedTitle,
  description,
  className,
  level = "B",
  variant = "infrastructure",
}: Props) {
  const copy = surfaceAdmissionRefusalCopy(refusal, { disconnectedTitle });
  const detail = description ?? copy.description;
  return (
    <div className={className ?? "space-y-3"}>
      <EmptyState
        variant={variant}
        level={level}
        title={copy.title}
        description={detail}
      />
      {showsConnectAction(refusal) ? <WalletLoginButton /> : null}
    </div>
  );
}
