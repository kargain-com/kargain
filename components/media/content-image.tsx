import Image from "next/image";

import { cn } from "@/lib/utils";

export type ContentImageProps = {
  src: string;
  alt: string;
  /** Responsive `sizes` for the optimizer — required. */
  sizes: string;
  /** First-viewport / LCP: eager + high fetch priority. */
  priority?: boolean;
  /** Cover (cards/hero) or contain (lightbox). */
  fit?: "cover" | "contain";
  className?: string;
};

/**
 * Sole renderer for content-addressed passport/listing photos (Arweave/Irys HTTP).
 * Parent must be `position: relative` with a definite size (`fill`).
 */
export function ContentImage({
  src,
  alt,
  sizes,
  priority = false,
  fit = "cover",
  className,
}: ContentImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn(
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
    />
  );
}
