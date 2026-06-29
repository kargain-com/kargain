"use client";

import { Progress } from "@/components/ui/progress";
import type { PassportFlowContext } from "@/lib/passport/passport-flow-messages";
import { uploadProgressSubtitle } from "@/lib/passport/passport-flow-messages";
import type { UploadProgress } from "@/lib/passport/upload-passport-metadata";

type Props = {
  uploadProgress: UploadProgress;
  context?: PassportFlowContext;
};

export function PassportUploadProgressPanel({
  uploadProgress,
  context = "create",
}: Props) {
  return (
    <div className="space-y-2">
      <p className="font-sans text-sm text-text-secondary">
        {uploadProgress.kind === "photos"
          ? uploadProgress.batch
            ? uploadProgress.current >= uploadProgress.total
              ? `Uploaded ${uploadProgress.total} photos`
              : `Uploading ${uploadProgress.total} photos (one wallet signature)…`
            : `Uploading photo ${uploadProgress.current} of ${uploadProgress.total}…`
          : "Preparing passport…"}
      </p>
      <p className="font-sans text-xs text-text-tertiary">
        {uploadProgressSubtitle(context)}
      </p>
      <Progress
        value={
          uploadProgress.kind === "photos"
            ? uploadProgress.total > 0
              ? (uploadProgress.current / uploadProgress.total) * 100
              : 0
            : 100
        }
      />
    </div>
  );
}
