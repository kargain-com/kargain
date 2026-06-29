"use client";

import { useState } from "react";

import { MetadataChangeSummary } from "@/components/passport/metadata-change-summary";
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
import type { MetadataDiffDisplay } from "@/lib/passport/format-metadata-diff-display";
import type { PassportStatus } from "@/lib/types/ponder";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  display: MetadataDiffDisplay | null;
  status: PassportStatus;
  onConfirm: () => void;
};

export function MetadataChangeConfirmDialog({
  open,
  onOpenChange,
  display,
  status,
  onConfirm,
}: Props) {
  const [acceptedReset, setAcceptedReset] = useState(false);

  const requiresResetAck =
    status === "VERIFIED" && (display?.hasIdentityChanges ?? false);

  const handleOpenChange = (next: boolean) => {
    if (!next) setAcceptedReset(false);
    onOpenChange(next);
  };

  const handleConfirm = () => {
    setAcceptedReset(false);
    onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review changes before saving</DialogTitle>
          <DialogDescription>
            Saving uploads a new metadata URI to Arweave. Review what will change before
            continuing.
          </DialogDescription>
        </DialogHeader>

        {display && <MetadataChangeSummary display={display} />}

        {requiresResetAck && (
          <div className="space-y-3">
            <p className="rounded-md border border-status-error/30 p-3 text-sm text-text-primary">
              This passport is verified. Identity or evidence changes require re-inspection and
              will reset verification to unverified.
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id="metadata-reset-accept"
                checked={acceptedReset}
                onCheckedChange={(v) => setAcceptedReset(v === true)}
              />
              <Label
                htmlFor="metadata-reset-accept"
                className="text-sm leading-snug text-text-primary"
              >
                I understand verification will be reset
              </Label>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={requiresResetAck && !acceptedReset}
            onClick={handleConfirm}
          >
            Confirm and save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
