import {
  buildKarProMetadataJson,
  parseKarProMetadataJson,
  type KarProProfileFields,
} from "@/lib/kar-pro/kar-pro-metadata";
import { uploadJson } from "@/lib/storage/irys-client";
import { withRetry } from "@/lib/storage/upload-with-retry";

const KAR_PRO_METADATA_TAGS = [
  { name: "app", value: "kargain" },
  { name: "type", value: "kar-pro-metadata" },
  { name: "version", value: "1.0" },
];

export async function uploadKarProMetadata(
  fields: KarProProfileFields,
  provider: unknown,
): Promise<string> {
  const body = buildKarProMetadataJson(fields);
  const metadata = parseKarProMetadataJson(body);
  if (!metadata) throw new Error("Invalid metadata.");
  return withRetry(() => uploadJson(metadata, KAR_PRO_METADATA_TAGS, provider));
}
