"use client";

import Link from "next/link";

import { CheckIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  EDIT_SUCCESS_TITLE,
  editSuccessBody,
} from "@/lib/passport/passport-flow-messages";

type Props = {
  tokenId: string;
  chainId: number;
  hadVerificationReset: boolean;
  onDismiss?: () => void;
};

export function PassportEditSuccessBanner({
  tokenId,
  chainId,
  hadVerificationReset,
  onDismiss,
}: Props) {
  return (
    <div
      className="flex gap-3 rounded-md border border-border-default bg-bg-surface p-4"
      role="status"
    >
      <CheckIcon
        size={18}
        className="mt-0.5 shrink-0 text-text-secondary"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-sans text-sm text-text-primary">{EDIT_SUCCESS_TITLE}</p>
        <p className="font-sans text-sm text-text-secondary">
          {editSuccessBody({ hadVerificationReset })}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>View passport</Link>
          </Button>
          {onDismiss && (
            <Button variant="ghost" size="sm" type="button" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
