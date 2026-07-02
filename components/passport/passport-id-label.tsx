import {
  formatKarPassportTitle,
  formatPassportShortLabel,
  formatPassportTitle,
  parsePassportTokenId,
} from "@/lib/passport/passport-token-id";
import { serialLabel } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

type Props = {
  tokenId: string;
  chainId?: number;
  prefix?: "passport" | "karPassport" | "none";
  variant?: "default" | "eyebrow" | "mono";
  showChain?: boolean;
  title?: boolean;
  className?: string;
};

function labelText(
  tokenId: string,
  chainId: number | undefined,
  prefix: NonNullable<Props["prefix"]>,
  showChain: boolean,
): string {
  if (prefix === "none") {
    const parsed = parsePassportTokenId(tokenId);
    const local = parsed.isV2Prefixed ? parsed.localId.toString() : parsed.full;
    if (!showChain || !parsed.isV2Prefixed) {
      if (!parsed.isV2Prefixed && chainId != null && chainId > 0 && showChain) {
        return formatPassportShortLabel(tokenId, chainId);
      }
      return `#${local}`;
    }
    return formatPassportShortLabel(tokenId, chainId);
  }
  if (prefix === "karPassport") {
    return formatKarPassportTitle(tokenId, chainId);
  }
  return formatPassportTitle(tokenId, chainId);
}

const variantClass: Record<NonNullable<Props["variant"]>, string> = {
  default: "font-sans text-sm text-text-secondary",
  eyebrow: serialLabel,
  mono: "font-mono text-[10px] text-text-secondary",
};

export function PassportIdLabel({
  tokenId,
  chainId,
  prefix = "passport",
  variant = "default",
  showChain = true,
  title: showTitle = true,
  className,
}: Props) {
  const text = labelText(tokenId, chainId, prefix, showChain);
  const fullId = parsePassportTokenId(tokenId).full;

  return (
    <span className={cn(variantClass[variant], className)} title={showTitle ? fullId : undefined}>
      {text}
    </span>
  );
}
