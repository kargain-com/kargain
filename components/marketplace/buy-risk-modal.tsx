"use client";

import Link from "next/link";
import { useState } from "react";

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
import type { getDetailStrings } from "@/lib/i18n/marketplace-detail-locales";
import type { PassportStatus } from "@/lib/types/ponder";

type T = ReturnType<typeof getDetailStrings>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
  tokenId: string;
  labels: T;
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
  labels: t,
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
          <DialogTitle>{t.buyRiskTitle}</DialogTitle>
          <DialogDescription>{t.buyRiskDescription}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-text-secondary">
          {passportStatus === "UNVERIFIED" && (
            <li className="rounded-md border border-status-error/30 p-3 text-text-primary">
              {t.buyRiskUnverified}
            </li>
          )}
          {passportStatus === "DISPUTED" && (
            <li className="rounded-md border border-status-error/30 p-3 text-text-primary">
              {t.buyRiskDisputed}{" "}
              <Link
                href="#passport-records"
                className="font-medium text-accent-warm underline-offset-2 hover:underline"
                onClick={() => onOpenChange(false)}
              >
                {t.buyRiskViewTimeline}
              </Link>
            </li>
          )}
          {duplicateVin && (
            <li className="rounded-md border border-status-error/30 p-3 text-text-primary">
              {t.buyRiskDuplicateVin}
            </li>
          )}
          {hadDispute && passportStatus === "UNVERIFIED" && (
            <li className="rounded-md border border-border-default p-3 text-text-secondary">
              {t.buyRiskPriorDispute}
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
            {t.buyRiskAcceptLabel}
          </Label>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t.buyRiskCancel}
          </Button>
          <Button
            type="button"
            disabled={!accepted || isPending}
            onClick={() => {
              onConfirm();
              setAccepted(false);
            }}
          >
            {t.buyRiskConfirm}
          </Button>
        </div>

        <p className="font-mono text-[10px] text-text-tertiary">#{tokenId}</p>
      </DialogContent>
    </Dialog>
  );
}
