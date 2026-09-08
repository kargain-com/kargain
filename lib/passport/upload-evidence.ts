import type { IrysTag } from "@/lib/passport/upload-passport-metadata";
import {
  resolveIrysUploadSession,
  type WalletUploadProviderArgs,
} from "@/lib/passport/upload-passport-metadata";
import {
  prepareUserPaidUploadForStack,
  uploadFileWithUploader,
} from "@/lib/storage/irys-client";
import { withRetry } from "@/lib/storage/upload-with-retry";

const EVIDENCE_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-evidence" },
];

export async function uploadEvidenceFile(
  file: File,
  args: WalletUploadProviderArgs,
): Promise<string> {
  const session = await resolveIrysUploadSession(args);
  const uploader = await prepareUserPaidUploadForStack(
    session.stack,
    session.provider,
    file.size,
  );
  return withRetry(() =>
    uploadFileWithUploader(uploader, file, EVIDENCE_TAGS),
  );
}
