"use client";

import Link from "next/link";
import { useState } from "react";

import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { PassportStatus } from "@/lib/types/ponder";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
  tokenId: string;
  onConfirm: () => void;
  isPending: boolean;
};

export function BuyRiskModal({
  open,
  onOpenChange,
  passportStatus,
  duplicateVin,
  hadDispute,
  tokenId,
  onConfirm,
  isPending,
}: Props) {
  const [accepted, setAccepted] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) setAccepted(false);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review purchase risks</DialogTitle>
          <DialogDescription>
            This passport has trust signals you should review before buying. You will inherit its
            on-chain status as the new owner.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-text-secondary">
          {passportStatus === "UNVERIFIED" && (
            <li className="rounded-md border border-status-error/30 p-3 text-text-primary">
              Passport is unverified — no independent inspection has confirmed the metadata.
            </li>
          )}
          {passportStatus === "DISPUTED" && (
            <li className="rounded-md border border-status-error/30 p-3 text-text-primary">
              Passport is disputed — review discrepancy records before proceeding.{" "}
              <Link
                href="#passport-records"
                className="font-medium text-accent-warm underline-offset-2 hover:underline"
                onClick={() => onOpenChange(false)}
              >
                View dispute timeline
              </Link>
            </li>
          )}
          {duplicateVin && (
            <li className="rounded-md border border-status-error/30 p-3 text-text-primary">
              Duplicate VIN — another passport shares this VIN in the index.
            </li>
          )}
          {hadDispute && passportStatus === "UNVERIFIED" && (
            <li className="rounded-md border border-border-default p-3 text-text-secondary">
              This passport had a prior dispute. Metadata may have changed since resolution.
            </li>
          )}
        </ul>

        <div className="flex items-start gap-3">
          <Checkbox
            id="buy-risk-accept"
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
          />
          <Label htmlFor="buy-risk-accept" className="text-sm leading-snug text-text-primary">
            I accept the risk and want to proceed with purchase
          </Label>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!accepted || isPending}
            onClick={() => {
              onConfirm();
              setAccepted(false);
            }}
          >
            Buy anyway
          </Button>
        </div>

        <PassportIdLabel tokenId={tokenId} prefix="none" variant="mono" className="text-text-tertiary" />
      </DialogContent>
    </Dialog>
  );
}
