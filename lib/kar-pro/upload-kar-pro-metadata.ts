import {
  buildKarProMetadataJson,
  parseKarProMetadataJson,
  type KarProProfileFields,
} from "@/lib/kar-pro/kar-pro-metadata";
import {
  resolveIrysUploadSession,
  type WalletUploadProviderArgs,
} from "@/lib/passport/upload-passport-metadata";
import {
  prepareUserPaidUploadForStack,
  uploadJsonWithUploader,
} from "@/lib/storage/irys-client";
import { withRetry } from "@/lib/storage/upload-with-retry";

const KAR_PRO_METADATA_TAGS = [
  { name: "app", value: "kargain" },
  { name: "type", value: "kar-pro-metadata" },
  { name: "version", value: "1.0" },
];

export async function uploadKarProMetadata(
  fields: KarProProfileFields,
  args: WalletUploadProviderArgs,
): Promise<string> {
  const body = buildKarProMetadataJson(fields);
  const metadata = parseKarProMetadataJson(body);
  if (!metadata) throw new Error("Invalid metadata.");
  const session = await resolveIrysUploadSession(args);
  const encoded = new TextEncoder().encode(JSON.stringify(metadata));
  const uploader = await prepareUserPaidUploadForStack(
    session.stack,
    session.provider,
    encoded.length,
  );
  return withRetry(() =>
    uploadJsonWithUploader(uploader, metadata, KAR_PRO_METADATA_TAGS),
  );
}
