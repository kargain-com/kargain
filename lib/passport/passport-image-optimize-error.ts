import { PASSPORT_IMAGE_TARGET_MAX_BYTES } from "@/lib/passport/passport-image-encode-plan";

export class PassportImageOptimizeError extends Error {
  readonly fileName: string;

  constructor(fileName: string, reason: "decode" | "encode" | "budget") {
    const kb = Math.round(PASSPORT_IMAGE_TARGET_MAX_BYTES / 1024);
    const message =
      reason === "decode"
        ? `Could not read "${fileName}". Try a different photo or export it as JPEG or PNG first.`
        : reason === "encode"
          ? `Could not optimize "${fileName}" for upload. Try a different photo.`
          : `Could not optimize "${fileName}" below ${kb} KB. Try a simpler photo or crop closer to the vehicle.`;
    super(message);
    this.name = "PassportImageOptimizeError";
    this.fileName = fileName;
  }
}
